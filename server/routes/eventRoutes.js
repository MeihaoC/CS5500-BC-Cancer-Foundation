const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

router.post('/login', eventController.login);
router.get('/events', eventController.getEvents);
router.get('/events/search', eventController.searchEvents);
router.post('/events', eventController.createEvent);
router.get('/events/:eventId/suggest-donors', eventController.suggestDonors);
router.post('/events/:eventId/donors/add', eventController.addDonorTemp);
router.post('/events/:eventId/donors/remove', eventController.removeDonorTemp);
router.post('/events/:eventId/donors/save', eventController.saveDonorList);
router.post('/events/:eventId/donors/cancel', eventController.cancelDonorEdits);
router.get('/events/:eventId/donors/search', eventController.searchDonorByName);
router.get('/events/:eventId/donors/export', eventController.exportDonorsCSV);

module.exports = router;
