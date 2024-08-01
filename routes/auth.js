const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Register route
router.post('/register', (req, res) => {
  const { username, password } = req.body;

  const checkSql = 'SELECT * FROM users WHERE username = ?';
  db.query(checkSql, [username], (err, results) => {
      if (err) {
          return res.json({ error: 'Database error during username check' });
      }
      if (results.length > 0) {
          return res.json({ error: 'Username already use!!!' }); // 409 Conflict
      }

      bcrypt.hash(password, 10, (err, hash) => {
          if (err) {
              return res.json({ error: 'Error hashing password' });
          }
          const sql = 'INSERT INTO users (username, password) VALUES (?, ?)';
          db.query(sql, [username, hash], (err, result) => {
              if (err) {
                  return res.json({ error: 'Database error during registration' });
              }
              res.status(201).json({ message: 'User registered successfully' });
          });
      });
  });
});


// Login route
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Check if the user exists
  const sql = 'SELECT * FROM users WHERE username = ?';
  db.query(sql, [username], (err, results) => {
    if (err) throw err;
    
    if (results.length === 0) {
      return res.send({ message: 'No user found' });
    }

    // Compare the password
    const user = results[0];
    bcrypt.compare(password, user.password,  (err, isMatch) => {
      if (err) throw err;
      
      if (!isMatch) {
        return res.send({ message: 'Password is incorrect' });
      }
    

      // Generate a token
      const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: '1h' });
      res.send({ message: 'Authentication successful', token });
    });
  });
});

module.exports = router;
