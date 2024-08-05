const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config(); // Load environment variables from .env file

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

connection.connect(err => {
  if (err) throw err;
  console.log('Connected to the MySQL server.');
});

// In-memory store for failed login attempts
const failedLoginAttempts = {};

// Register route
app.post('/register', (req, res) => {
  const { username, password } = req.body;

  const checkSql = 'SELECT * FROM users WHERE username = ?';
  connection.query(checkSql, [username], (err, results) => {
    if (err) {
      return res.json({ error: 'Database error during username check' });
    }
    if (results.length > 0) {
      return res.json({ error: 'Username already in use' }); 
    }

    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        return res.json({ error: 'Error hashing password' });
      }
      const sql = 'INSERT INTO users (username, password) VALUES (?, ?)';
      connection.query(sql, [username, hash], (err, result) => {
        if (err) {
          return res.json({ error: 'Database error during registration' });
        }
        res.status(201).json({ message: 'User registered successfully' });
      });
    });
  });
});

// Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Check if the user is locked out
  if (failedLoginAttempts[username] && failedLoginAttempts[username].count >= 5) {
    const now = Date.now();
    const timeSinceLastAttempt = now - failedLoginAttempts[username].lastAttempt;
    console.log('time',timeSinceLastAttempt)  
    if (timeSinceLastAttempt < 300000) { // 5 minutes in milliseconds
      return res.status(429).send({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
    } else {
      // Reset the failed attempts counter after the lockout period
      failedLoginAttempts[username].count = 0;
    }
  }

  const sql = 'SELECT * FROM users WHERE username = ?';
  connection.query(sql, [username], (err, results) => {
    if (err) throw err;

    if (results.length === 0) {
      return res.send({ message: 'No user found' });
    }

    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) throw err;

      if (!isMatch) {
        // Track the failed login attempt
        if (!failedLoginAttempts[username]) {
          failedLoginAttempts[username] = { count: 1, lastAttempt: Date.now() };
        } else {
          failedLoginAttempts[username].count++;
          failedLoginAttempts[username].lastAttempt = Date.now();
        }

        const remainingAttempts = 5 - failedLoginAttempts[username].count;
        return res.send({ message: `Password is incorrect. You have ${remainingAttempts} attempts left.` });
      }

      // Reset the failed attempts counter on successful login
      if (failedLoginAttempts[username]) {
        failedLoginAttempts[username].count = 0;
      }

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

      // Fetch all user data
      const userSql = 'SELECT * FROM users WHERE id = ?';
      connection.query(userSql, [user.id], (err, userData) => {
        if (err) throw err;

        res.send({
          message: 'Authentication successful',
          token,
          user: userData[0]
        });
      });
    });
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
