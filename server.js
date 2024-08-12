const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS


// Initialize Firebase Admin SDK
const serviceAccount = require('./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json');
const e = require('express');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Optionally you can add databaseURL here
});

// Database connection (TiDB compatible with SSL)
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    ca: fs.readFileSync('./certs/isrgrootx1.pem'), // Replace with the actual path to your CA certificate
  }
});

connection.connect(err => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the TiDB server.');
});

// In-memory store for failed login attempts


// Generate OTP
function generateOtp() {
  const otp = crypto.randomBytes(3).toString('hex'); // 3 bytes = 6 hex characters
  return parseInt(otp, 16).toString().slice(0, 4); // Convert to an integer and then take the first 6 digits
}

// Send OTP to the user's email
function sendOtpEmail(email, otp, callback) {
  const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
          user: process.env.email,
          pass: process.env.emailpassword
      }
  });

  const mailOptions = {
      from: process.env.email,
      to: email,
      subject: 'Your OTP Code',
      text: `Your OTP code is ${otp}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
          return callback(error);
      }
      callback(null, info);
  });
}

function sendResetOTPEmail(email, OTP, callback) {
  // Create a transporter object using SMTP transport
  const transporter = nodemailer.createTransport({
      service: 'Gmail', 
      auth: {
        user: process.env.email,
        pass: process.env.emailpassword
      }
  });

  // Email options
  const mailOptions = {
      from: process.env.email, // Sender address
      to: email,                   // List of recipients
      subject: 'Password Reset Request', // Subject line
      text: `Here is your password reset OTP: ${OTP}\n\nThe OTP is valid for 10 minutes. If you didn't request this, please ignore this email.`, // Plain text body
      html: `<p>Here is your password reset OTP: <strong>${OTP}</strong></p><p>The OTP is valid for 10 minutes. If you didn't request this, please ignore this email.</p>` // HTML body
  };

  // Send email
  transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
          return callback(error);
      }
      callback(null, info);
  });
}

app.post('/register/email', (req, res) => {
  const { email } = req.body;

  const checkSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(checkSql, [email], (err, results) => {
      if (err) {
          console.error('Database error during email check:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length > 0) {
          return res.status(400).json({ error: 'Email already in use or used in another sign-in' });
      }

      const otp = generateOtp(); // Implement this function to generate a random OTP
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      const findOtpSql = 'SELECT * FROM otps WHERE email = ?';
      connection.query(findOtpSql, [email], (err, otpResults) => {
          if (err) {
              console.error('Database error during OTP retrieval:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          if (otpResults.length > 0) {
              // Update existing OTP
              const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
              connection.query(updateOtpSql, [otp, expiresAt, email], (err, updateResult) => {
                  if (err) {
                      console.error('Database error during OTP update:', err);
                      return res.status(500).json({ error: 'Internal server error' });
                  }
                  sendOtpEmail(email, otp, (error, info) => {
                      if (error) {
                          console.error('Error sending OTP email:', error);
                          return res.status(500).json({ error: 'Error sending OTP email' });
                      }
                      res.status(200).json({ message: 'OTP sent to email' });
                  });
              });
          } else {
              // Insert new OTP
              const insertOtpSql = 'INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)';
              connection.query(insertOtpSql, [email, otp, expiresAt], (err, insertResult) => {
                  if (err) {
                      console.error('Database error during OTP insertion:', err);
                      return res.status(500).json({ error: 'Internal server error' });
                  }
                  sendOtpEmail(email, otp, (error, info) => {
                      if (error) {
                          console.error('Error sending OTP email:', error);
                          return res.status(500).json({ error: 'Error sending OTP email' });
                      }
                      res.status(200).json({ message: 'OTP sent to email' });
                  });
              });
          }
      });
  });
});




// Step 2: Verify OTP
app.post('/register/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  const verifyOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ? AND otp = ?';
  connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) {
          console.error('Database error during OTP verification:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'Invalid OTP' });
      }

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // OTP has expired
          return res.status(400).json({ error: 'OTP has expired' });
      }

      // OTP verified and valid, now the user can proceed to set a password
      res.status(200).json({ message: 'OTP verified, you can set your password now' });
  });
});


// Step 3: Register User
app.post('/register/set-password', (req, res) => {
  const { email, password } = req.body;

  bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
          return res.json({ error: 'Error hashing password' });
      }

      const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
      connection.query(sql, [email, hash], (err, result) => {
          if (err) {
              return res.json({ error: 'Database error during registration' });
          }

          // Remove the OTP entry as it's no longer needed
          const deleteOtpSql = 'DELETE FROM otps WHERE email = ?';
          connection.query(deleteOtpSql, [email], (err, result) => {
              if (err) {
                  return res.json({ error: 'Database error during OTP cleanup' });
              }

              res.status(201).json({ message: 'User registered successfully' });
          });
      });
  });
});


app.post('/resend-otp', (req, res) => {
  const { email } = req.body;

  const findOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ?';
  connection.query(findOtpSql, [email], (err, results) => {
      if (err) {
          console.error('Database error during OTP lookup:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'No OTP found for this email. Please register first.' });
      }

      const { otp, expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // If OTP has expired, generate a new one
          const newOtp = generateOtp();
          const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now
          const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
          connection.query(updateOtpSql, [newOtp, newExpiresAt, email], (err, result) => {
              if (err) {
                  console.error('Database error during OTP update:', err);
                  return res.status(500).json({ error: 'Internal server error' });
              }

              // Send the new OTP
              sendOtpEmail(email, newOtp, (error, info) => {
                  if (error) {
                      console.error('Error sending new OTP email:', error);
                      return res.status(500).json({ error: 'Error sending OTP email' });
                  }
                  res.status(200).json({ message: 'New OTP sent to email' });
              });
          });
      } else {
          // OTP is still valid, resend the existing one
          sendOtpEmail(email, otp, (error, info) => {
              if (error) {
                  console.error('Error resending OTP email:', error);
                  return res.status(500).json({ error: 'Error sending OTP email' });
              }
              res.status(200).json({ message: 'OTP resent to email' });
          });
      }
  });
});



app.post('/forgot-password', (req, res) => {
  const { email } = req.body;

  // Check if the email exists
  const userCheckSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(userCheckSql, [email], (err, userResults) => {
      if (err) {
          console.error('Database error during email check:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (userResults.length === 0) {
          return res.status(400).json({ error: 'Email not found' });
      }

      const otp = generateOtp(); // Implement OTP generation securely
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

      // Check if an OTP already exists for this email
      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      connection.query(otpCheckSql, [email], (err, otpResults) => {
          if (err) {
              console.error('Database error during OTP check:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          if (otpResults.length > 0) {
              // Update existing OTP
              const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
              connection.query(updateOtpSql, [otp, expiresAt, email], (err, updateResult) => {
                  if (err) {
                      console.error('Database error during OTP update:', err);
                      return res.status(500).json({ error: 'Internal server error' });
                  }
                  sendOtpEmail(email, otp, (error, info) => {
                      if (error) {
                          console.error('Error sending OTP email:', error);
                          return res.status(500).json({ error: 'Error sending OTP email' });
                      }
                      res.status(200).json({ message: 'OTP sent to email' });
                  });
              });
          } else {
              // Save new OTP
              const saveOtpSql = 'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp = VALUES(otp), expires_at = VALUES(expires_at)';
              connection.query(saveOtpSql, [email, otp, expiresAt, otp, expiresAt], (err, result) => {
                  if (err) {
                      console.error('Database error during OTP save:', err);
                      return res.status(500).json({ error: 'Internal server error' });
                  }
                  sendOtpEmail(email, otp, (error, info) => {
                      if (error) {
                          console.error('Error sending OTP email:', error);
                          return res.status(500).json({ error: 'Error sending OTP email' });
                      }
                      res.status(200).json({ message: 'OTP sent to email' });
                  });
              });
          }
      });
  });
});



app.post('/verify-reset-otp', (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const verifyOtpSql = 'SELECT otp, expires_at FROM password_resets WHERE email = ? AND otp = ?';
  connection.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) {
          console.error('Database error during OTP verification:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (results.length === 0) {
          return res.status(400).json({ error: 'Invalid OTP or email' });
      }

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
          // OTP has expired
          return res.status(400).json({ error: 'OTP has expired' });
      }

      // OTP is valid
      res.status(200).json({ message: 'OTP is valid, you can set a new password' });
  });
});

app.post('/reset-password', (req, res) => {
  const { email, newPassword } = req.body;

  // Hash the new password
  bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
      if (err) {
          console.error('Error hashing password:', err); // Log the detailed error
          return res.status(500).json({ error: 'Error hashing password' });
      }

      // Update the user's password
      const updatePasswordSql = 'UPDATE users SET password = ? WHERE email = ?';
      connection.query(updatePasswordSql, [hashedPassword, email], (err, result) => {
          if (err) {
              console.error('Database error during password update:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          // Optionally, delete the used OTP (if you want to clear the record)
          const deleteOtpSql = 'DELETE FROM password_resets WHERE email = ?';
          connection.query(deleteOtpSql, [email], (err, result) => {
              if (err) {
                  console.error('Database error during OTP deletion:', err);
              }
              res.status(200).json({ message: 'Password has been updated successfully' });
          });
      });
  });
});



app.post('/resent-otp', (req, res) => {
  const { email } = req.body;

  // Check if the email exists
  const userCheckSql = 'SELECT * FROM users WHERE email = ?';
  connection.query(userCheckSql, [email], (err, userResults) => {
      if (err) {
          console.error('Database error during email check:', err);
          return res.status(500).json({ error: 'Internal server error' });
      }
      if (userResults.length === 0) {
          return res.status(400).json({ error: 'Email not found' });
      }

      // Check if there is an existing OTP for this email
      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      connection.query(otpCheckSql, [email], (err, otpResults) => {
          if (err) {
              console.error('Database error during OTP check:', err);
              return res.status(500).json({ error: 'Internal server error' });
          }

          if (otpResults.length === 0) {
              return res.status(400).json({ error: 'No OTP record found for this email' });
          }

          const otp = generateOtp(); // Implement OTP generation securely
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

          // Update existing OTP
          const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
          connection.query(updateOtpSql, [otp, expiresAt, email], (err, updateResult) => {
              if (err) {
                  console.error('Database error during OTP update:', err);
                  return res.status(500).json({ error: 'Internal server error' });
              }
              sendOtpEmail(email, otp, (error, info) => {
                  if (error) {
                      console.error('Error sending OTP email:', error);
                      return res.status(500).json({ error: 'Error sending OTP email' });
                  }
                  res.status(200).json({ message: 'New OTP sent to email' });
              });
          });
      });
  });
});




const failedLoginAttempts = {}; // Initialize this globally

// Login route
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  // Initialize failed attempts entry if it doesn't exist
  if (!failedLoginAttempts[email]) {
    failedLoginAttempts[email] = { count: 0, lastAttempt: Date.now() };
  }

  // Check if the user is locked out
  if (failedLoginAttempts[email].count >= 5) {
    const now = Date.now();
    const timeSinceLastAttempt = now - failedLoginAttempts[email].lastAttempt;
    if (timeSinceLastAttempt < 300000) { // 5 minutes in milliseconds
      return res.status(429).json({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
    } else {
      // Reset the failed attempts counter after the lockout period
      failedLoginAttempts[email].count = 0;
    }
  }

  const sql = 'SELECT id, password FROM users WHERE email = ?';
  connection.query(sql, [email], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No user found' });
    }

    const user = results[0];

    // Check if password is null
    if (user.password === null) {
      return res.status(400).json({ message: 'Email already used for another sign-in.' });
    }

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error('Password comparison error:', err);
        return res.status(500).json({ error: 'Error comparing passwords' });
      }

      if (!isMatch) {
        // Track the failed login attempt
        failedLoginAttempts[email].count++;
        failedLoginAttempts[email].lastAttempt = Date.now();

        const remainingAttempts = 5 - failedLoginAttempts[email].count;
        return res.status(401).json({ message: `Password is incorrect. You have ${remainingAttempts} attempts left.` });
      }

      // Reset the failed attempts counter on successful login
      failedLoginAttempts[email].count = 0;

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

      // Fetch user data
      const userSql = 'SELECT * FROM users WHERE id = ?';
      connection.query(userSql, [user.id], (err, userData) => {
        if (err) {
          console.error('Database error fetching user data:', err);
          return res.status(500).json({ error: 'Error fetching user data' });
        }

        // Ensure userData has the expected structure
        const user = userData.length > 0 ? userData[0] : null;

        res.status(200).json({
          message: 'Authentication successful',
          token,
          user
        });
      });
    });
  });
});


app.post('/google-signin', (req, res) => {
  const { googleId, email, name, picture } = req.body;

  // Validate the input
  if (!googleId || !email || !name || !picture) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  console.log('Received data from client:', { googleId, email, name, picture });

  // Check if the user already exists in the database based on googleId
  const checkSql = 'SELECT * FROM users WHERE google_id = ?';
  connection.query(checkSql, [googleId], (err, results) => {
    if (err) {
      console.error('Database error during Google ID check:', err);
      return res.status(500).json({ error: 'Database error during check' });
    }

    if (results.length > 0) {
      // User exists, update their information
      const user = results[0];
      const updateSql = `
        UPDATE users 
        SET email = ?, name = ?, picture = ? 
        WHERE google_id = ?
      `;
      connection.query(updateSql, [email, name, picture, googleId], (err) => {
        if (err) {
          console.error('Database error during user update:', err);
          return res.status(500).json({ error: 'Database error during update' });
        }

        const token = jwt.sign(
          { id: user.id, email: user.email, google_id: user.google_id },
          process.env.JWT_SECRET, // Ensure you use process.env.JWT_SECRET
          
        );
        console.log('User updated:', { token, googleId, email, name, picture });
        return res.json({
          message: 'User information updated successfully',
          token,
          user: {
            id: user.id,
            email: user.email,
            google_id: user.google_id,
            name: user.name,
            picture: user.picture,
          },
        });
      });
    } else {
      // User does not exist, insert new user
      const insertSql = 'INSERT INTO users (google_id, email, name, picture) VALUES (?, ?, ?, ?)';
      connection.query(insertSql, [googleId, email, name, picture], (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            console.error('Duplicate entry error:', err);
            return res.status(409).json({ error: 'Email already registered' });
          } else {
            console.error('Database error during user insertion:', err);
            return res.status(500).json({ error: 'Database error during registration' });
          }
        }

        // Fetch the newly inserted user
        const newUserId = result.insertId;
        const newUserSql = 'SELECT * FROM users WHERE id = ?';
        connection.query(newUserSql, [newUserId], (err, results) => {
          if (err) {
            console.error('Database error during new user fetch:', err);
            return res.status(500).json({ error: 'Database error during new user fetch' });
          }

          const newUser = results[0];
          const token = jwt.sign(
            { id: newUser.id, email: newUser.email, google_id: newUser.google_id },
            process.env.JWT_SECRET, // Ensure you use process.env.JWT_SECRET
            
          );

          return res.status(201).json({
            message: 'User registered and authenticated successfully',
            token,
            user: {
              id: newUser.id,
              email: newUser.email,
              google_id: newUser.google_id,
              name: newUser.name,
              picture: newUser.picture,
            },
          });
        });
      });
    }
  });
});




// Facebook Sign-In route
app.post('/facebook-signin', async (req, res) => {
  const { facebookId, email, name, picture } = req.body;

  try {
    // Check if the user already exists in the database
    const checkSql = 'SELECT * FROM users WHERE facebook_id = ?';
    connection.query(checkSql, [facebookId], (err, results) => {
      if (err) {
        console.error('Database error during Facebook ID check:', err);
        return res.status(500).json({ error: 'Database error during Facebook ID check' });
      }

      if (results.length > 0) {
        // User exists, update their information
        const user = results[0];
        const updateSql = 'UPDATE users SET name = ?, email = ?, picture = ? WHERE facebook_id = ?';
        connection.query(updateSql, [name, email, picture, facebookId], (err) => {
          if (err) {
            console.error('Database error during Facebook update:', err);
            return res.status(500).json({ error: 'Database error during Facebook update' });
          }

          const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
          console.log('User registered:', {jwtToken });
          return res.json({
            message: 'User information updated successfully',
            token: jwtToken,
            user: {
              id: user.id,
              facebook_id: facebookId,
              name,
              email,
              picture,
            },
          });
        });
      } else {
        // User doesn't exist, register them
        const registerSql = 'INSERT INTO users (facebook_id, name, email, picture) VALUES (?, ?, ?, ?)';
        connection.query(registerSql, [facebookId, name, email, picture], (err, result) => {
          if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
              console.error('Duplicate entry error:', err);
              return res.status(409).json({ error: 'Email already registered' });
            } else {
              console.error('Database error during user insertion:', err);
              return res.status(500).json({ error: 'Database error during registration' });
            }
          }

          const userId = result.insertId;
          const jwtToken = jwt.sign({ id: userId }, process.env.JWT_SECRET);
          console.log('User registered:', {jwtToken });
          return res.status(201).json({
            message: 'User registered and authenticated successfully',
            token: jwtToken,
            user: {
              id: userId,
              facebook_id: facebookId,
              name,
              email,
              picture,
            },
          });
        });
      }
    });
  } catch (error) {
    console.error('Facebook authentication error:', error);
    res.status(401).json({ error: 'Invalid Facebook token' });
  }
});





// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
