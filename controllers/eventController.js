const db = require('../db');

function getStatus(donorCount, capacity) {
  if (donorCount === 0) return 'Not Started';
  if (donorCount < capacity) return 'In Process';
  return 'Fully Invited';
}

const tempDonorEdits = new Map();

exports.getEvents = async (req, res) => {
  try {
    const [events] = await db.execute('SELECT * FROM Event');
    const [donorCounts] = await db.execute('SELECT event_id, COUNT(*) AS count FROM Event_Donor GROUP BY event_id');
    const countMap = Object.fromEntries(donorCounts.map(r => [r.event_id, r.count]));
    const enriched = events.map(e => ({ ...e, status: getStatus(countMap[e.id] || 0, e.capacity) }));
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
};

exports.searchEvents = async (req, res) => {
  const { q } = req.query;
  try {
    let query = 'SELECT * FROM Event WHERE 1=1';
    const params = [];

    if (q) {
      query += ` AND (
        name LIKE ? OR
        city LIKE ? OR
        medical_focus LIKE ? OR
        coordinator LIKE ? OR
        fundraiser LIKE ?
      )`;
      for (let i = 0; i < 5; i++) params.push(`%${q}%`);
    }

    const [events] = await db.execute(query, params);
    const [donorCounts] = await db.execute('SELECT event_id, COUNT(*) AS count FROM Event_Donor GROUP BY event_id');
    const countMap = Object.fromEntries(donorCounts.map(r => [r.event_id, r.count]));
    const enriched = events.map(e => ({ ...e, status: getStatus(countMap[e.id] || 0, e.capacity) }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to search events' });
  }
};

exports.createEvent = async (req, res) => {
  const { name, date, city, location, medical_focus, capacity, coordinator, fundraiser, details } = req.body;
  try {
    await db.execute(`
      INSERT INTO Event (name, date, city, location, medical_focus, capacity, coordinator, fundraiser, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, date, city, location, medical_focus, capacity, coordinator, fundraiser, details]);
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

    const [donors] = await db.execute(`
      SELECT d.id, CONCAT(d.first_name, ' ', d.last_name) AS name, d.city, d.email, d.total_donation, d.engagement,
             GROUP_CONCAT(mf.name) AS medical_focus, d.pmm
      FROM Donor d
      JOIN Donor_Medical_Focus dm ON d.id = dm.donor_id
      JOIN Medical_Focus mf ON dm.medical_focus_id = mf.id
      GROUP BY d.id
    `);

    const [saved] = await db.execute('SELECT donor_id FROM Event_Donor WHERE event_id = ?', [eventId]);
    const savedIds = new Set(saved.map(r => r.donor_id));
    const edits = tempDonorEdits.get(eventId) || { added: new Set(), removed: new Set() };
    const matches = [];
    const used = new Set([...savedIds, ...edits.added]);

    const selectedCity = req.query.city || event.city;
    const selectedFocus = req.query.medical_focus || event.medical_focus;
    const selectedEngagement = req.query.engagement || 'Highly Engaged';

    const filters = [
      d => d.city === selectedCity && d.medical_focus.includes(selectedFocus) && d.engagement === selectedEngagement,
      d => d.city === selectedCity && d.engagement === selectedEngagement,
      d => d.city === selectedCity && d.medical_focus.includes(selectedFocus),
      d => d.medical_focus.includes(selectedFocus) && d.engagement === selectedEngagement,
      d => d.city === selectedCity,
      d => d.engagement === selectedEngagement,
      d => d.medical_focus.includes(selectedFocus)
    ];

    for (const filter of filters) {
      for (const d of donors) {
        if (matches.length >= event.capacity * 2) break;
        if (!used.has(d.id) && filter(d)) {
          matches.push(d);
          used.add(d.id);
        }
      }
    }

    while (matches.length < event.capacity * 2) {
      const remaining = donors.filter(d => !used.has(d.id));
      if (!remaining.length) break;
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      matches.push(pick);
      used.add(pick.id);
    }

    const best = matches.slice(0, event.capacity);
    const additional = matches.slice(event.capacity);
    res.json({ best, additional });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate donor suggestions' });
  }
};

exports.addDonorTemp = (req, res) => {
  const { eventId } = req.params;
  const { donorId } = req.body;
  if (!tempDonorEdits.has(eventId)) tempDonorEdits.set(eventId, { added: new Set(), removed: new Set() });
  const edits = tempDonorEdits.get(eventId);
  edits.removed.delete(donorId);
  edits.added.add(donorId);
  res.json({ message: 'Donor temporarily added' });
};

exports.removeDonorTemp = (req, res) => {
  const { eventId } = req.params;
  const { donorId } = req.body;
  if (!tempDonorEdits.has(eventId)) tempDonorEdits.set(eventId, { added: new Set(), removed: new Set() });
  const edits = tempDonorEdits.get(eventId);
  edits.added.delete(donorId);
  edits.removed.add(donorId);
  res.json({ message: 'Donor temporarily removed' });
};

exports.saveDonorList = async (req, res) => {
  const { eventId } = req.params;
  const edits = tempDonorEdits.get(eventId);
  if (!edits) return res.status(400).json({ error: 'No edits to save' });
  try {
    await db.execute('DELETE FROM Event_Donor WHERE event_id = ?', [eventId]);
    for (const donorId of edits.added) {
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
      WHERE (d.first_name LIKE ? OR d.last_name LIKE ?)
      GROUP BY d.id
    `, [`%${name}%`, `%${name}%`]);

    const filtered = results.filter(d =>
      (!savedIds.has(d.id) || edits.removed.has(d.id)) && !edits.added.has(d.id)
    );

    res.json(filtered);
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
      ...donors.map(d => [d.name, d.total_donation, d.city, d.medical_focus, d.engagement, d.email, d.pmm])
    ].map(row => row.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="donors.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export donor list' });
  }
};
