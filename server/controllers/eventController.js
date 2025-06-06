const db = require('../db');

function getStatus(donorCount, capacity) {
  if (donorCount === 0) return 'Not Started';
  if (donorCount < capacity) return 'In Process';
  return 'Fully Invited';
}

const tempDonorEdits = new Map();

function formatDateToReadable(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function formatCurrency(amount) {
  return `$${Number(amount).toLocaleString('en-US')}`;
}

exports.getEvents = async (req, res) => {
  try {
    const [events] = await db.execute(`
      SELECT
        e.id,
        e.name, e.date, e.city, e.capacity,
        mf.name AS medical_focus,
        c.name AS coordinator,
        f.name AS fundraiser
      FROM Event e
      JOIN Medical_Focus mf ON e.medical_focus_id = mf.id
      JOIN User c ON e.coordinator_id = c.id
      JOIN User f ON e.fundraiser_id = f.id
    `);

    const [donorCounts] = await db.execute(
      'SELECT event_id, COUNT(*) AS count FROM Event_Donor GROUP BY event_id'
    );
    const countMap = Object.fromEntries(donorCounts.map(r => [r.event_id, r.count]));

    const enriched = events.map(e => ({
      ...e,
      date: formatDateToReadable(e.date),
      status: getStatus(countMap[e.id] || 0, e.capacity)
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
};


exports.searchEvents = async (req, res) => {
  const { field, query } = req.query;

  const allowedFields = ['name', 'city', 'medical_focus', 'coordinator', 'fundraiser', 'status'];
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: 'Invalid search field' });
  }

  try {
    const [events] = await db.execute(`
      SELECT e.id, e.name, e.date, e.city, e.capacity, 
             mf.name AS medical_focus, 
             u1.name AS coordinator, 
             u2.name AS fundraiser
      FROM Event e
      JOIN Medical_Focus mf ON e.medical_focus_id = mf.id
      JOIN User u1 ON e.coordinator_id = u1.id
      JOIN User u2 ON e.fundraiser_id = u2.id
    `);

    const [donorCounts] = await db.execute(
      'SELECT event_id, COUNT(*) AS count FROM Event_Donor GROUP BY event_id'
    );
    const countMap = Object.fromEntries(donorCounts.map(r => [r.event_id, r.count]));

    const enriched = events.map(e => ({
      id: e.id,
      name: e.name,
      date: formatDateToReadable(e.date),
      city: e.city,
      medical_focus: e.medical_focus,
      capacity: e.capacity,
      coordinator: e.coordinator,
      fundraiser: e.fundraiser,
      status: getStatus(countMap[e.id] || 0, e.capacity),
    }));

    let filtered = enriched;

    if (field && query) {
      filtered = enriched.filter(e => {
        const value = e[field];
        return value && String(value).toLowerCase().includes(query.toLowerCase());
      });
    }

    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search events' });
  }
};


exports.createEvent = async (req, res) => {
  const {
    name,
    date,
    city,
    location,
    medical_focus,
    capacity,
    coordinator,
    fundraiser,
    details
  } = req.body;

  // Check if capacity is a positive number
  if (!Number.isInteger(Number(capacity)) || Number(capacity) <= 0) {
    return res.status(400).json({ error: 'Capacity must be a positive number' });
  }
  
  try {
    const [[focusRow]] = await db.execute(
      'SELECT id FROM Medical_Focus WHERE name = ?',
      [medical_focus]
    );
    if (!focusRow) return res.status(400).json({ error: 'Invalid medical focus' });

    const [[coordRow]] = await db.execute(
      'SELECT id FROM User WHERE name = ?',
      [coordinator]
    );
    if (!coordRow) return res.status(400).json({ error: 'Invalid coordinator' });

    const [[fundRow]] = await db.execute(
      'SELECT id FROM User WHERE name = ?',
      [fundraiser]
    );
    if (!fundRow) return res.status(400).json({ error: 'Invalid fundraiser' });

    await db.execute(
      `INSERT INTO Event 
        (name, date, location, city, medical_focus_id, capacity, coordinator_id, fundraiser_id, detailed_info, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        date,
        location,
        city,
        focusRow.id,
        capacity,
        coordRow.id,
        fundRow.id,
        details,
        'Not Started'
      ]
    );

    const [[{ id }]] = await db.execute('SELECT LAST_INSERT_ID() AS id');
    res.json({ message: 'Event created successfully', eventId: id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
};

exports.suggestDonors = async (req, res) => {
  const eventId = req.params.eventId;
  try {
    const [[event]] = await db.execute('SELECT * FROM Event WHERE id = ?', [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    let listSize = parseInt(req.query.listSize, 10);
    if (!Number.isInteger(listSize) || listSize <= 0) {
      listSize = event.capacity;
    }

    const [donors] = await db.execute(`
      SELECT d.id, CONCAT(d.first_name, ' ', d.last_name) AS name, d.city, d.email, d.total_donation, d.engagement,
             GROUP_CONCAT(mf.name) AS medical_focus, d.pmm
      FROM Donor d
      JOIN Donor_Medical_Focus dm ON d.id = dm.donor_id
      JOIN Medical_Focus mf ON dm.medical_focus_id = mf.id
      GROUP BY d.id
    `);

    const donorsWithArrayFocus = donors.map(d => ({
      ...d,
      medical_focus: d.medical_focus ? d.medical_focus.split(',') : [],
      total_donation: formatCurrency(d.total_donation)
    }));

    const [saved] = await db.execute('SELECT donor_id FROM Event_Donor WHERE event_id = ?', [eventId]);
    const savedIds = new Set(saved.map(r => r.donor_id));
    const edits = tempDonorEdits.get(eventId) || { added: new Set(), removed: new Set() };

    const selectedCity = req.query.city || event.city;
    const selectedFocus = req.query.medical_focus || event.medical_focus;
    const selectedEngagement = req.query.engagement || 'Highly Engaged';

    const engagementRank = {
      'Highly Engaged': 3,
      'Moderately Engaged': 2,
      'Rarely Engaged': 1
    };

    const isEligible = (d) => {
      return (!edits.added.has(d.id) && !savedIds.has(d.id)) || edits.removed.has(d.id);
    };

    const filters = [
      d => d.city === selectedCity && d.medical_focus.includes(selectedFocus) && d.engagement === selectedEngagement,
      d => d.city === selectedCity && d.engagement === selectedEngagement,
      d => d.city === selectedCity && d.medical_focus.includes(selectedFocus),
      d => d.medical_focus.includes(selectedFocus) && d.engagement === selectedEngagement,
      d => d.city === selectedCity,
      d => d.engagement === selectedEngagement,
      d => d.medical_focus.includes(selectedFocus)
    ];

    const matches = [];
    const used = new Set();

    for (const filter of filters) {
      const tierMatches = donorsWithArrayFocus
        .filter(d => !used.has(d.id) && isEligible(d) && filter(d))
        .sort((a, b) => engagementRank[b.engagement] - engagementRank[a.engagement]);

      for (const d of tierMatches) {
        if (matches.length >= listSize * 2) break;
        matches.push(d);
        used.add(d.id);
      }

      if (matches.length >= listSize * 2) break;
    }

    while (matches.length < listSize * 2) {
      const remaining = donorsWithArrayFocus.filter(d => !used.has(d.id) && isEligible(d));
      if (!remaining.length) break;
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      matches.push(pick);
      used.add(pick.id);
    }

    const best = matches.slice(0, listSize);
    const additional = matches.slice(listSize);
    res.json({ best, additional });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate donor suggestions' });
  }
};



exports.addDonorTemp = (req, res) => {
  const { eventId } = req.params;
  const donorIds = req.body.donorIds; // expecting an array like [1, 2, 3]

  if (!Array.isArray(donorIds)) {
    return res.status(400).json({ error: 'Invalid donorIds format' });
  }

  if (!tempDonorEdits.has(eventId)) {
    tempDonorEdits.set(eventId, { added: new Set(), removed: new Set() });
  }

  const edits = tempDonorEdits.get(eventId);

  donorIds.forEach(donorId => {
    edits.removed.delete(donorId);
    edits.added.add(donorId);
  });

  res.json({ message: 'Donors temporarily added' });
};


exports.removeDonorTemp = (req, res) => {
  const { eventId } = req.params;
  const donorId = Number(req.body.donorId);

  if (!tempDonorEdits.has(eventId)) {
    tempDonorEdits.set(eventId, { added: new Set(), removed: new Set() });
  }

  const edits = tempDonorEdits.get(eventId);
  edits.added.delete(donorId);      
  edits.removed.add(donorId);
  
  res.json({ message: 'Donor temporarily removed' });
};

exports.saveDonorList = async (req, res) => {
  const { eventId } = req.params;
  const edits = tempDonorEdits.get(eventId);
  if (!edits) {
    return res.json({ message: 'No changes made to donor list' });
  }

  if (edits.added.size === 0 && edits.removed.size === 0) {
    tempDonorEdits.delete(eventId);
    return res.json({ message: 'No changes made to donor list' });
  }

  try {
    const [existing] = await db.execute('SELECT donor_id FROM Event_Donor WHERE event_id = ?', [eventId]);
    const kept = existing
      .map(r => r.donor_id)
      .filter(id => !edits.removed.has(id));

    const finalSet = new Set([...kept, ...edits.added]);

    await db.execute('DELETE FROM Event_Donor WHERE event_id = ?', [eventId]);

    for (const donorId of finalSet) {
      await db.execute('INSERT INTO Event_Donor (event_id, donor_id) VALUES (?, ?)', [eventId, donorId]);
    }

    tempDonorEdits.delete(eventId);
    res.json({ message: 'Donor list saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save donor list' });
  }
};


exports.cancelDonorEdits = (req, res) => {
  tempDonorEdits.delete(req.params.eventId);
  res.json({ message: 'Donor edits canceled' });
};

exports.searchDonorByName = async (req, res) => {
  const { name } = req.query;
  const { eventId } = req.params;

  if (!name || name.trim() === '') {
    return res.json([]);
  }

  try {
    const edits = tempDonorEdits.get(eventId) || { added: new Set(), removed: new Set() };
    const [saved] = await db.execute('SELECT donor_id FROM Event_Donor WHERE event_id = ?', [eventId]);
    const savedIds = new Set(saved.map(r => r.donor_id));

    const [results] = await db.execute(`
      SELECT d.id, CONCAT(d.first_name, ' ', d.last_name) AS name, d.city, d.email, d.total_donation, d.engagement,
             GROUP_CONCAT(mf.name) AS medical_focus, d.pmm
      FROM Donor d
      JOIN Donor_Medical_Focus dm ON d.id = dm.donor_id
      JOIN Medical_Focus mf ON dm.medical_focus_id = mf.id
      WHERE CONCAT(d.first_name, ' ', d.last_name) LIKE ?
         OR d.first_name LIKE ?
         OR d.last_name LIKE ?
      GROUP BY d.id
    `, [`%${name}%`, `%${name}%`, `%${name}%`]);

    const formatted = results
      .map(d => ({
        ...d,
        medical_focus: d.medical_focus ? d.medical_focus.split(',') : [],
        total_donation: formatCurrency(d.total_donation)
      }))
      .filter(d => (!savedIds.has(d.id) || edits.removed.has(d.id)) && !edits.added.has(d.id));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Donor search failed' });
  }
};


exports.exportDonorsCSV = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [donors] = await db.execute(`
      SELECT CONCAT(d.first_name, ' ', d.last_name) AS name, d.total_donation, d.city, 
             GROUP_CONCAT(mf.name) AS medical_focus, d.engagement, d.email, d.pmm
      FROM Event_Donor ed
      JOIN Donor d ON ed.donor_id = d.id
      JOIN Donor_Medical_Focus dm ON d.id = dm.donor_id
      JOIN Medical_Focus mf ON dm.medical_focus_id = mf.id
      WHERE ed.event_id = ?
      GROUP BY d.id
    `, [eventId]);

    const csv = [
      ['Donor Name', 'Total Donations', 'City', 'Medical Focus', 'Engagement', 'Email Address', 'PMM'],
      ...donors.map(d => [d.name, formatCurrency(d.total_donation), d.city, d.medical_focus, d.engagement, d.email, d.pmm])
    ].map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="donors.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export donor list' });
  }
};

exports.getEventDetails = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [[event]] = await db.execute(`
      SELECT e.name, e.date, e.location, e.city, e.capacity, 
             mf.name AS medical_focus, 
             u1.name AS coordinator, 
             u2.name AS fundraiser,
             e.detailed_info
      FROM Event e
      JOIN Medical_Focus mf ON e.medical_focus_id = mf.id
      JOIN User u1 ON e.coordinator_id = u1.id
      JOIN User u2 ON e.fundraiser_id = u2.id
      WHERE e.id = ?
    `, [eventId]);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    event.raw_date = event.date;
    event.date = formatDateToReadable(event.date);

    res.json(event);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event details' });
  }
};

exports.getDonorListForEvent = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [donors] = await db.execute(`
      SELECT d.id,
             CONCAT(d.first_name, ' ', d.last_name) AS name,
             d.total_donation,
             d.city,
             GROUP_CONCAT(mf.name) AS medical_focus,
             d.engagement,
             d.email,
             d.pmm
      FROM Event_Donor ed
      JOIN Donor d ON ed.donor_id = d.id
      JOIN Donor_Medical_Focus dm ON d.id = dm.donor_id
      JOIN Medical_Focus mf ON dm.medical_focus_id = mf.id
      WHERE ed.event_id = ?
      GROUP BY d.id
    `, [eventId]);

    const formatted = donors.map(d => ({
      ...d,
      medical_focus: d.medical_focus ? d.medical_focus.split(',') : [],
      total_donation: formatCurrency(d.total_donation)
    }));    

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch donor list' });
  }
};

exports.getMedicalFocusNames = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT name FROM Medical_Focus');
    const names = rows.map(row => row.name);
    res.json(names);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get medical focuses' });
  }
};

exports.getUserNames = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT name FROM User');
    const names = rows.map(row => row.name);
    res.json(names);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get user names' });
  }
};

exports.getEventCities = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT DISTINCT city FROM Event ORDER BY city');
    const cities = rows.map(row => row.city);
    res.json(cities);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch cities' });
  }
};

exports.deleteEvent = async (req, res) => {
  const { eventId } = req.params;
  try {
    await db.execute('DELETE FROM Event WHERE id = ?', [eventId]);
    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
};

exports.updateEvent = async (req, res) => {
  const { eventId } = req.params;
  const {
    name,
    date,
    city,
    location,
    medical_focus,
    capacity,
    coordinator,
    fundraiser,
    details
  } = req.body;

  if (!Number.isInteger(Number(capacity)) || Number(capacity) <= 0) {
    return res.status(400).json({ error: 'Capacity must be a positive number' });
  }

  try {
    const [[focusRow]] = await db.execute(
      'SELECT id FROM Medical_Focus WHERE name = ?',
      [medical_focus]
    );
    if (!focusRow) return res.status(400).json({ error: 'Invalid medical focus' });

    const [[coordRow]] = await db.execute(
      'SELECT id FROM User WHERE name = ?',
      [coordinator]
    );
    if (!coordRow) return res.status(400).json({ error: 'Invalid coordinator' });

    const [[fundRow]] = await db.execute(
      'SELECT id FROM User WHERE name = ?',
      [fundraiser]
    );
    if (!fundRow) return res.status(400).json({ error: 'Invalid fundraiser' });

    await db.execute(
      `UPDATE Event 
       SET name = ?, date = ?, location = ?, city = ?, medical_focus_id = ?, capacity = ?, coordinator_id = ?, fundraiser_id = ?, detailed_info = ?
       WHERE id = ?`,
      [
        name,
        date,
        location,
        city,
        focusRow.id,
        capacity,
        coordRow.id,
        fundRow.id,
        details,
        eventId
      ]
    );

    res.json({ message: 'Event updated successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update event' });
  }
};
