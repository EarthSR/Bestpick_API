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
const multer = require('multer');
require('dotenv').config();
const path = require('path');
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS

// Initialize Firebase Admin SDK
const serviceAccount = require('./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Database connection (TiDB compatible with SSL)
// Create Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    ca: fs.readFileSync('./certs/isrgrootx1.pem'), // Replace with the actual path to your CA certificate
  },
  connectionLimit: 10, // Set the maximum number of connections in the pool
});


console.log('Database connected using Connection Pool.');


// Verify Token Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'No token provided or incorrect format' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id; // Store the user ID for later use
    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Generate OTP
function generateOtp() {
  const otp = crypto.randomBytes(3).toString('hex'); // 3 bytes = 6 hex characters
  return parseInt(otp, 16).toString().slice(0, 4); 
}

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
    html: `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2 style="color: #007bff;">Your OTP Code</h2>
        <p>Hello,</p>
        <p>We received a request to verify your email address. Please use the OTP code below to complete the process:</p>
        <div style="padding: 10px; border: 2px solid #007bff; display: inline-block; font-size: 24px; color: #007bff; font-weight: bold;">
          ${otp}
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn’t request this, please ignore this email.</p>
        <p style="margin-top: 20px;">Thanks, <br> The Team</p>
        <hr>
        <p style="font-size: 12px; color: #999;">This is an automated email, please do not reply.</p>
      </div>
    `
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending OTP email:', error); // Log the error for debugging purposes
      return callback({ error: 'Failed to send OTP email. Please try again later.' });
    }
    callback(null, info); // Proceed if the email was successfully sent
  });
}


// Register a new email user
app.post('/register/email', async (req, res) => {
  try {
    const { email } = req.body;
    const checkRegisteredSql = 'SELECT * FROM users WHERE email = ? AND password IS NOT NULL';

    pool.query(checkRegisteredSql, [email], (err, results) => {
      if (err) throw new Error('Database error during email registration check');
      if (results.length > 0) return res.status(400).json({ error: 'Email already registered' });

      const checkSql = 'SELECT * FROM users WHERE email = ? AND password IS NULL';
      pool.query(checkSql, [email], (err, results) => {
        if (err) throw new Error('Database error during email check');
        if (results.length > 0) return res.status(400).json({ error: 'Email already in use or used in another sign-in' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const findOtpSql = 'SELECT * FROM otps WHERE email = ?';
        pool.query(findOtpSql, [email], (err, otpResults) => {
          if (err) throw new Error('Database error during OTP retrieval');

          if (otpResults.length > 0) {
            const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
            pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
              if (err) throw new Error('Database error during OTP update');
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error('Error sending OTP email');
                res.status(200).json({ message: 'OTP sent to email' });
              });
            });
          } else {
            const insertOtpSql = 'INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)';
            pool.query(insertOtpSql, [email, otp, expiresAt], (err) => {
              if (err) throw new Error('Database error during OTP insertion');
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error('Error sending OTP email');
                res.status(200).json({ message: 'OTP sent to email' });
              });
            });
          }
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify OTP
app.post('/register/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const verifyOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ? AND otp = ?';
    
    pool.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error('Database error during OTP verification');
      if (results.length === 0) return res.status(400).json({ error: 'Invalid OTP' });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) return res.status(400).json({ error: 'OTP has expired' });

      res.status(200).json({ message: 'OTP verified, you can set your password now' });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register User
app.post('/register/set-password', async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);

    const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
    pool.query(sql, [email, hash], (err) => {
      if (err) throw new Error('Database error during registration');

      const deleteOtpSql = 'DELETE FROM otps WHERE email = ?';
      pool.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error('Database error during OTP cleanup');
        res.status(201).json({ message: 'User registered successfully' });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP for Registration
app.post('/resend-otp/register', async (req, res) => {
  try {
    const { email } = req.body;
    const findOtpSql = 'SELECT otp, expires_at FROM otps WHERE email = ?';

    pool.query(findOtpSql, [email], (err, results) => {
      if (err) throw new Error('Database error during OTP lookup');
      if (results.length === 0) return res.status(400).json({ error: 'No OTP found for this email. Please register first.' });

      const { otp, expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
        const newOtp = generateOtp();
        const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
        const updateOtpSql = 'UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?';
        pool.query(updateOtpSql, [newOtp, newExpiresAt, email], (err) => {
          if (err) throw new Error('Database error during OTP update');
          sendOtpEmail(email, newOtp, (error) => {
            if (error) throw new Error('Error sending OTP email');
            res.status(200).json({ message: 'New OTP sent to email' });
          });
        });
      } else {
        sendOtpEmail(email, otp, (error) => {
          if (error) throw new Error('Error resending OTP email');
          res.status(200).json({ message: 'OTP resent to email' });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot Password
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql = 'SELECT * FROM users WHERE email = ? AND password IS NOT NULL';

    pool.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error('Database error during email check');
      if (userResults.length === 0) return res.status(400).json({ error: 'Email not found' });

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      pool.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error('Database error during OTP check');

        if (otpResults.length > 0) {
          const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
          pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
            if (err) throw new Error('Database error during OTP update');
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error('Error sending OTP email');
              res.status(200).json({ message: 'OTP sent to email' });
            });
          });
        } else {
          const saveOtpSql = 'INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?)';
          pool.query(saveOtpSql, [email, otp, expiresAt], (err) => {
            if (err) throw new Error('Database error during OTP save');
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error('Error sending OTP email');
              res.status(200).json({ message: 'OTP sent to email' });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify Reset OTP
app.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const verifyOtpSql = 'SELECT otp, expires_at FROM password_resets WHERE email = ? AND otp = ?';
    pool.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error('Database error during OTP verification');
      if (results.length === 0) return res.status(400).json({ error: 'Invalid OTP or email' });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) return res.status(400).json({ error: 'OTP has expired' });

      res.status(200).json({ message: 'OTP is valid, you can set a new password' });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset Password
app.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatePasswordSql = 'UPDATE users SET password = ? WHERE email = ?';
    pool.query(updatePasswordSql, [hashedPassword, email], (err) => {
      if (err) throw new Error('Database error during password update');

      const deleteOtpSql = 'DELETE FROM password_resets WHERE email = ?';
      pool.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error('Database error during OTP deletion');
        res.status(200).json({ message: 'Password has been updated successfully' });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend OTP for Reset Password
app.post('/resent-otp/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql = 'SELECT * FROM users WHERE email = ?';

    pool.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error('Database error during email check');
      if (userResults.length === 0) return res.status(400).json({ error: 'Email not found' });

      const otpCheckSql = 'SELECT * FROM password_resets WHERE email = ?';
      pool.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error('Database error during OTP check');
        if (otpResults.length === 0) return res.status(400).json({ error: 'No OTP record found for this email' });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const updateOtpSql = 'UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?';
        pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
          if (err) throw new Error('Database error during OTP update');
          sendOtpEmail(email, otp, (error) => {
            if (error) throw new Error('Error sending OTP email');
            res.status(200).json({ message: 'New OTP sent to email' });
          });
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get the user's IP address (optional)
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    const sql = 'SELECT * FROM users WHERE email = ?';
    pool.query(sql, [email], (err, results) => {
      if (err) throw new Error('Database error during login');
      if (results.length === 0) {
        return res.status(404).json({ message: 'No user found' });
      }

      const user = results[0];

      // Check if the user signed up with Google
      if (user.google_id !== null) {
        return res.status(400).json({ message: 'Please sign in using Google.' });
      }


      // If the user has exceeded failed login attempts, block them for 5 minutes
      if (user.failed_attempts >= 5 && user.last_failed_attempt) {
        const now = Date.now();
        const timeSinceLastAttempt = now - new Date(user.last_failed_attempt).getTime();
        if (timeSinceLastAttempt < 300000) { // 5 minutes
          return res.status(429).json({ message: 'Too many failed login attempts. Try again in 5 minutes.' });
        }
      }

      // Compare the entered password with the stored hashed password
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) throw new Error('Password comparison error');
        if (!isMatch) {
          // Increment failed attempts and update last_failed_attempt
          const updateFailSql = 'UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = NOW() WHERE id = ?';
          pool.query(updateFailSql, [user.id], (err) => {
            if (err) console.error('Error logging failed login attempt:', err);
          });

          const remainingAttempts = 5 - (user.failed_attempts + 1); // +1 for current attempt
          return res.status(401).json({ message: `Email or Password is incorrect. You have ${remainingAttempts} attempts left.` });
        }

        // Reset failed attempts after a successful login
        const resetFailSql = 'UPDATE users SET failed_attempts = 0, last_login = NOW(), last_login_ip = ? WHERE id = ?';
        pool.query(resetFailSql, [ipAddress, user.id], (err) => {
          if (err) throw new Error('Error resetting failed attempts or updating login time.');

          // Generate JWT token
          const token = jwt.sign({ id: user.id }, JWT_SECRET);

          // Return successful login response with token and user data
          res.status(200).json({
            message: 'Authentication successful',
            token,
            user: {
              id: user.id,
              email,
              username: user.username,
              picture: user.picture,
              last_login: new Date(),
              last_login_ip: ipAddress
            }
          });
        });
      });
    });
  } catch (error) {
    console.error('Internal error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});



//set username
app.post('/set-username', verifyToken, (req, res) => {
  const { newUsername } = req.body;
  const userId = req.userId; // Use the user ID extracted from the token

  // Ensure that the new username is provided
  if (!newUsername) {
    return res.status(400).json({ message: 'New username is required' });
  }

  // Check if the username is already taken
  const checkUsernameQuery = 'SELECT * FROM users WHERE username = ?';
  pool.query(checkUsernameQuery, [newUsername], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Database error checking username' });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    // Update the user's username
    const updateUsernameQuery = 'UPDATE users SET username = ? WHERE id = ?';
    pool.query(updateUsernameQuery, [newUsername, userId], (err) => {
      if (err) {
        return res.status(500).json({ message: 'Error updating username' });
      }

      return res.status(200).json({ message: 'Username set successfully' });
    });
  });
});





// Google Sign-In
app.post('/google-signin', async (req, res) => {
  try {
    const { googleId, email } = req.body;

    if (!googleId || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const checkGoogleIdSql = 'SELECT * FROM users WHERE google_id = ?';
    pool.query(checkGoogleIdSql, [googleId], (err, googleIdResults) => {
      if (err) throw new Error('Database error during Google ID check');

      if (googleIdResults.length > 0) {
        const user = googleIdResults[0];
        const updateSql = 'UPDATE users SET email = ? WHERE google_id = ?';
        pool.query(updateSql, [email, googleId], (err) => {
          if (err) throw new Error('Database error during user update');

          const token = jwt.sign({ id: user.id}, JWT_SECRET);
          return res.json({
            message: 'User information updated successfully',
            token,
            user: {
              id: user.id,
              email: user.email,
              picture: user.picture,
              username: user.username,
              google_id: user.google_id,
            },
          });
        });
      } else {
        const checkEmailSql = 'SELECT * FROM users WHERE email = ?';
        pool.query(checkEmailSql, [email], (err, emailResults) => {
          if (err) throw new Error('Database error during email check');
          if (emailResults.length > 0) return res.status(409).json({ error: 'Email already registered with another account' });

          const insertSql = 'INSERT INTO users (google_id, email, username) VALUES (?, ?, "")';
          pool.query(insertSql, [googleId, email], (err, result) => {
            if (err) throw new Error('Database error during user insertion');

            const newUserId = result.insertId;
            const newUserSql = 'SELECT * FROM users WHERE id = ?';
            pool.query(newUserSql, [newUserId], (err, newUserResults) => {
              if (err) throw new Error('Database error during new user fetch');

              const newUser = newUserResults[0];
              const token = jwt.sign({ id: newUser.id}, JWT_SECRET);

              return res.status(201).json({
                message: 'User registered and authenticated successfully',
                token,
                user: {
                  id: newUser.id,
                  email: newUser.email,
                  picture: newUser.picture,
                  username: newUser.username,
                  google_id: newUser.google_id,
                },
              });
            });
          });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Record User Interaction (Like, Comment, etc.)
app.post('/interactions', async (req, res) => {
  try {
    const { user_id, post_id, action_type } = req.body;

    if (!user_id || !post_id || !action_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const query = 'INSERT INTO user_interactions (user_id, post_id, action_type) VALUES (?, ?, ?)';
    const values = [user_id, post_id, action_type];

    pool.query(query, values, (err, results) => {
      if (err) throw new Error('Database error during interaction recording');
      res.status(201).json({ message: 'Interaction recorded successfully', interaction_id: results.insertId });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function isValidJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}


// API สำหรับตรวจสอบสถานะการกดไลค์ของผู้ใช้
app.get('/api/checkLikeStatus/:postId/:userId', verifyToken, (req, res) => {
  const { postId, userId } = req.params;
  const user_id = req.userId;

  // ตรวจสอบสิทธิ์ว่าผู้ใช้มีสิทธิ์ในการเข้าถึงหรือไม่
  if (user_id != userId) {
    return res.status(403).json({ error: 'Unauthorized access: User ID does not match' });
  }

  // ตรวจสอบว่า postId และ userId มีค่า
  if (!postId || !userId) {
    return res.status(400).json({ error: 'Missing required parameters: postId or userId' });
  }

  // SQL Query เพื่อเช็คสถานะการกดไลค์ในตาราง likes
  const query = `
    SELECT COUNT(*) AS isLiked
    FROM likes 
    WHERE post_id = ? AND user_id = ?
  `;

  pool.query(query, [postId, userId], (err, results) => {
    if (err) {
      console.error('Database error during like status check:', err);
      return res.status(500).json({ error: 'Internal server error during like status check' });
    }

    // ตรวจสอบสถานะการกดไลค์ (ถ้าผลลัพธ์มากกว่า 0 แสดงว่ามีการกดไลค์)
    const isLiked = results[0].isLiked > 0;
    console.log('isLiked:', isLiked);
    res.json({ isLiked });
  });
});


// View All Posts with Token Verification
app.get('/posts', verifyToken, (req, res) => {
  try {
    const userId = req.userId; // ดึง user_id จาก token ที่ผ่านการตรวจสอบแล้ว

    const query = `
      SELECT posts.*, users.username, users.picture, 
      (SELECT COUNT(*) FROM likes WHERE post_id = posts.id AND user_id = ?) AS is_liked
      FROM posts 
      JOIN users ON posts.user_id = users.id
    `;

    pool.query(query, [userId], (err, results) => {
      if (err) {
        console.error('Database error during posts retrieval:', err);
        return res.status(500).json({ error: 'Internal server error during posts retrieval' });
      }

      const parsedResults = results.map(post => {
        const photoUrls = Array.isArray(post.photo_url) ? post.photo_url.map(photo => photo) : [];
        const videoUrls = Array.isArray(post.video_url) ? post.video_url.map(video => video) : [];

        return {
          id: post.id,
          content: post.content,
          time: post.time,
          updated: post.updated_at,
          photo_url: photoUrls,
          video_url: videoUrls,
          userName: post.username,
          userProfileUrl: post.picture ? post.picture : null,
          is_liked: post.is_liked > 0 // แปลงค่า is_liked เป็น boolean (`true` ถ้า like, `false` ถ้าไม่ like)
        };
      });

      res.json(parsedResults);
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// View a Single Post with Like and Comment Count and Show Comments
app.get('/posts/:id', verifyToken, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId; // ดึง user_id จาก token ที่ผ่านการตรวจสอบแล้ว

    const queryPost = `
      SELECT p.*, u.username, u.picture, 
      (SELECT COUNT(*) FROM likes WHERE post_id = ?) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = ?) AS comment_count,
      (SELECT COUNT(*) FROM likes WHERE post_id = ? AND user_id = ?) AS is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id 
      WHERE p.id = ?;
    `;

    const queryComments = `
      SELECT c.*, u.username, u.picture AS user_profile
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?;
    `;

    pool.query(queryPost, [id, id, id, userId, id], (err, postResults) => {
      if (err) {
        console.error('Database error during post retrieval:', err);
        return res.status(500).json({ error: 'Internal server error during post retrieval' });
      }
      if (postResults.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const post = postResults[0];
      post.photo_url = isValidJson(post.photo_url) ? JSON.parse(post.photo_url) : [post.photo_url];
      post.video_url = isValidJson(post.video_url) ? JSON.parse(post.video_url) : [post.video_url];
      post.is_liked = post.is_liked > 0; // แปลงค่า is_liked ให้เป็น boolean

      pool.query(queryComments, [id], (err, commentResults) => {
        if (err) {
          console.error('Database error during comments retrieval:', err);
          return res.status(500).json({ error: 'Internal server error during comments retrieval' });
        }

        res.json({
          ...post,
          like_count: post.like_count,
          comment_count: post.comment_count,
          is_liked: post.is_liked, // เพิ่มสถานะการไลค์ของผู้ใช้ในข้อมูลโพสต์
          comments: commentResults.map(comment => ({
            id: comment.id,
            content: comment.comment_text,
            created_at: comment.created_at,
            username: comment.username,
            user_profile: comment.user_profile ? comment.user_profile : null
          }))
        });
      });
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});








// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});

const upload = multer({ storage });


// Create a Post
app.post('/posts/create', verifyToken, upload.fields([{ name: 'photo', maxCount: 10 }, { name: 'video', maxCount: 10 }]), (req, res) => {
  try {
    const { user_id, content } = req.body;
    let photo_urls = [];
    let video_urls = [];

    // Ensure the user is creating a post for their own account
    if (parseInt(req.userId) !== parseInt(user_id)) {
      return res.status(403).json({ error: 'You are not authorized to create a post for this user' });
    }

    // Get uploaded photo URLs
    if (req.files['photo']) {
      photo_urls = req.files['photo'].map(file => `/uploads/${file.filename}`);
    }

    // Get uploaded video URLs
    if (req.files['video']) {
      video_urls = req.files['video'].map(file => `/uploads/${file.filename}`);
    }

    // Convert arrays to JSON strings for storage
    const photo_urls_json = JSON.stringify(photo_urls);
    const video_urls_json = JSON.stringify(video_urls);

    const query = 'INSERT INTO posts (user_id, content, video_url, photo_url) VALUES (?, ?, ?, ?)';
    pool.query(query, [user_id, content, video_urls_json, photo_urls_json], (err, results) => {
      if (err) {
        console.error('Database error during post creation:', err);
        return res.status(500).json({ error: 'Database error during post creation' });
      }
      res.status(201).json({
        post_id: results.insertId,
        user_id,
        content,
        video_urls: video_urls,
        photo_urls: photo_urls
      });
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a Post
app.put('/posts/:id', verifyToken, upload.fields([{ name: 'photo', maxCount: 10 }, { name: 'video', maxCount: 10 }]), (req, res) => {
  try {
    const { id } = req.params;
    const { content, user_id } = req.body;
    let photo_urls = [];
    let video_urls = [];

    // Ensure the user is updating their own post
    if (parseInt(req.userId) !== parseInt(user_id)) {
      return res.status(403).json({ error: 'You are not authorized to update this post' });
    }

    // Get uploaded photo URLs
    if (req.files['photo']) {
      photo_urls = req.files['photo'].map(file => `/uploads/${file.filename}`);
    }

    // Get uploaded video URLs
    if (req.files['video']) {
      video_urls = req.files['video'].map(file => `/uploads/${file.filename}`);
    }

    // Convert arrays to JSON strings for storage
    const photo_urls_json = JSON.stringify(photo_urls);
    const video_urls_json = JSON.stringify(video_urls);

    const query = 'UPDATE posts SET content = ?, video_url = ?, photo_url = ?, updated_at = NOW() WHERE post_id = ? AND user_id = ?';
    pool.query(query, [content, video_urls_json, photo_urls_json, id, user_id], (err, results) => {
      if (err) {
        console.error('Database error during post update:', err);
        return res.status(500).json({ error: 'Database error during post update' });
      }
      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Post not found or you are not the owner' });
      }
      res.json({
        post_id: id,
        content,
        video_urls: video_urls,
        photo_urls: photo_urls
      });
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Delete a Post
app.delete('/posts/:id', verifyToken, (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (parseInt(req.userId) !== parseInt(user_id)) {
      return res.status(403).json({ error: 'You are not authorized to delete this post' });
    }

    pool.query('DELETE FROM posts WHERE post_id = ? AND user_id = ?', [id, user_id], (err, results) => {
      if (err) {
        console.error('Database error during post deletion:', err);
        return res.status(500).json({ error: 'Database error during post deletion' });
      }
      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Post not found or you are not the owner' });
      }
      res.json({ message: 'Post deleted successfully' });
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API สำหรับกด like หรือ unlike โพสต์
app.post('/posts/like/:id', verifyToken, (req, res) => {
  const { id } = req.params; // Post ID จาก URL
  const { user_id } = req.body; // User ID จาก body ของ request

  try {
    // ตรวจสอบว่า userId ใน token ตรงกับ user_id ใน body หรือไม่
    if (parseInt(req.userId) !== parseInt(user_id)) {
      return res.status(403).json({ error: 'You are not authorized to like this post' });
    }

    // ตรวจสอบว่าโพสต์นั้นมีอยู่ในฐานข้อมูลหรือไม่
    const checkPostSql = 'SELECT * FROM posts WHERE id = ?';
    pool.query(checkPostSql, [id], (err, postResults) => {
      if (err) {
        console.error('Database error during post check:', err);
        return res.status(500).json({ error: 'Database error during post check' });
      }
      if (postResults.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      // ตรวจสอบว่า user ได้กด like โพสต์นี้แล้วหรือยัง
      const checkLikeSql = 'SELECT * FROM likes WHERE post_id = ? AND user_id = ?';
      pool.query(checkLikeSql, [id, user_id], (err, likeResults) => {
        if (err) {
          console.error('Database error during like check:', err);
          return res.status(500).json({ error: 'Database error during like check' });
        }

        if (likeResults.length > 0) {
          // ถ้าผู้ใช้กด like แล้ว ให้ unlike (ลบ like ออก)
          const unlikeSql = 'DELETE FROM likes WHERE post_id = ? AND user_id = ?';
          pool.query(unlikeSql, [id, user_id], (err) => {
            if (err) {
              console.error('Database error during unlike:', err);
              return res.status(500).json({ error: 'Database error during unlike' });
            }

            // หลังจาก unlike เสร็จ ให้ดึงค่า likeCount ใหม่
            const likeCountQuery = 'SELECT COUNT(*) AS likeCount FROM likes WHERE post_id = ?';
            pool.query(likeCountQuery, [id], (err, countResults) => {
              if (err) {
                console.error('Database error during like count:', err);
                return res.status(500).json({ error: 'Database error during like count' });
              }
              const likeCount = countResults[0].likeCount;
              res.status(200).json({ message: 'Post unliked successfully', status: 'unliked', liked: false, likeCount });
            });
          });
        } else {
          // ถ้ายังไม่กด like ให้เพิ่มการ like
          const likeSql = 'INSERT INTO likes (post_id, user_id) VALUES (?, ?)';
          pool.query(likeSql, [id, user_id], (err) => {
            if (err) {
              console.error('Database error during like:', err);
              return res.status(500).json({ error: 'Database error during like' });
            }

            // หลังจาก like เสร็จ ให้ดึงค่า likeCount ใหม่
            const likeCountQuery = 'SELECT COUNT(*) AS likeCount FROM likes WHERE post_id = ?';
            pool.query(likeCountQuery, [id], (err, countResults) => {
              if (err) {
                console.error('Database error during like count:', err);
                return res.status(500).json({ error: 'Database error during like count' });
              }
              const likeCount = countResults[0].likeCount;
              res.status(201).json({ message: 'Post liked successfully', status: 'liked', liked: true, likeCount });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error('Internal server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});





// Serve static files (uploaded images and videos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Search API with grouped results by username, and include only the first photo_url
app.get('/search', (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  // Trim the query to remove any leading/trailing spaces and convert it to lowercase
  const searchValue = `%${query.trim().toLowerCase()}%`;

  // SQL query to search posts by content, title, or username, and include user_id, post_id, title, and photo_url
  const searchSql = `
    SELECT 
      u.id AS user_id,                -- Include user ID
      u.username, 
      p.id AS post_id,                -- Include post ID
      LEFT(p.content, 100) AS content_preview,  -- Show the first 100 characters as a preview
      p.title,                        -- Include post title
      p.photo_url                     -- Include the photo_url as a string
    FROM users u
    LEFT JOIN posts p ON p.user_id = u.id
    WHERE LOWER(u.username) LIKE ? 
      OR LOWER(p.content) LIKE ? 
      OR LOWER(p.title) LIKE ?        -- Add search condition for title
    ORDER BY p.updated_at DESC
  `;

  pool.query(searchSql, [searchValue, searchValue, searchValue], (err, results) => {
    if (err) {
      console.error('Database error during search:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No results found' });
    }

    // Group the results by username and aggregate their posts
    const groupedResults = results.reduce((acc, post) => {
      const username = post.username;

      // ตรวจสอบประเภทของ photo_url และแปลงเป็นสตริงถ้าจำเป็น
      let photoUrlString = "";
      if (post.photo_url) {
        // กรณี photo_url เป็น object เช่น ถูกดึงมาเป็น JSON object แทน string
        if (typeof post.photo_url === "object") {
          console.log('photo_url object content:', post.photo_url);

          // ลองแปลงเป็นสตริง JSON
          try {
            photoUrlString = JSON.stringify(post.photo_url);
            console.warn(`photo_url is an object, converted to JSON string: ${photoUrlString}`);
          } catch (e) {
            console.error('Failed to stringify photo_url:', e);
            photoUrlString = ""; // ถ้าไม่สามารถแปลงได้ ให้เป็นค่าว่าง
          }
        } else if (Buffer.isBuffer(post.photo_url)) {
          photoUrlString = post.photo_url.toString(); // แปลง Buffer เป็นสตริง
        } else if (typeof post.photo_url === "string") {
          photoUrlString = post.photo_url; // หากเป็นสตริงอยู่แล้วให้ใช้ได้เลย
        } else {
          console.warn(`Unexpected type for photo_url: ${typeof post.photo_url}`);
        }
      }

      // ตรวจสอบและแปลง photo_url ที่เป็นสตริงให้อยู่ในรูปแบบอาร์เรย์
      let firstPhotoUrl = "";
      try {
        // ตรวจสอบว่า photo_url เป็น JSON Array หรือไม่
        if (photoUrlString.startsWith("[") && photoUrlString.endsWith("]")) {
          // ถ้าเป็น JSON Array, ใช้ JSON.parse
          const photoArray = JSON.parse(photoUrlString);
          if (Array.isArray(photoArray) && photoArray.length > 0) {
            firstPhotoUrl = photoArray[0];  // ดึงเฉพาะรูปภาพแรกจากอาร์เรย์
          }
        } else {
          // ถ้า photo_url เป็นสตริงธรรมดาที่คั่นด้วยจุลภาค
          const photoArray = photoUrlString.split(",");
          firstPhotoUrl = photoArray[0];  // ดึงเฉพาะรูปภาพแรกจากการแยกสตริง
        }
      } catch (e) {
        console.error('Error parsing photo_url:', e);
        firstPhotoUrl = ""; // กรณีที่ photo_url ไม่สามารถแปลงได้ ให้เป็นค่าว่าง
      }

      // Check if the username already exists in the accumulator (grouped results)
      const existingUser = acc.find(user => user.username === username);

      if (existingUser) {
        // If the username exists, add the post information to their posts array
        existingUser.posts.push({
          post_id: post.post_id,         // Add post_id to the post object
          title: post.title,             // Include title in the post object
          content_preview: post.content_preview,
          photo_url: firstPhotoUrl       // Include only the first photo_url
        });
      } else {
        // If the username does not exist, create a new entry for the user
        acc.push({
          user_id: post.user_id,         // Include user_id in the user object
          username: post.username,
          posts: [{
            post_id: post.post_id,       // Add post_id to the post object
            title: post.title,           // Include title in the post object
            content_preview: post.content_preview,
            photo_url: firstPhotoUrl     // Include only the first photo_url
          }]
        });
      }

      return acc;
    }, []); // Start with an empty array for grouping

    // ส่งข้อมูล groupedResults กลับในรูปแบบ JSON
    res.json({ results: groupedResults });
  });
});



// API endpoint to get user profile data
app.get('/api/users/:userId/profile', verifyToken, (req, res) => {
  const userId = req.params.userId;

  if (req.userId.toString() !== userId) {
    return res.status(403).json({ error: 'You are not authorized to view this profile' });
}

  // SQL query to get user profile and count posts
  const sql = `
      SELECT 
      u.id AS userId, 
      u.username, 
      u.picture AS profileImageUrl,
      u.bio ,
      u.gender, 
      COUNT(p.id) AS post_count,
      (SELECT COUNT(*) FROM follower_following WHERE following_id = u.id) AS follower_count, 
      (SELECT COUNT(*) FROM follower_following WHERE follower_id = u.id) AS following_count   
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      WHERE u.id = ?
      GROUP BY u.id;
  `;

  pool.query(sql, [userId], (error, results) => {
      if (error) {
          return res.status(500).json({ error: 'Database error while fetching user profile' });
      }
      if (results.length === 0) {
          return res.status(404).json({ error: 'User not found' });
      }

      const userProfile = results[0];

      // Construct the response
      const response = {
          userId: userProfile.userId,
          username: userProfile.username,
          profileImageUrl: userProfile.profileImageUrl,
          followerCount: userProfile.follower_count,
          followingCount: userProfile.following_count,
          postCount: userProfile.post_count,
          gender: userProfile.gender,
          bio:userProfile.bio
      };

      // Send the response
      res.json(response);
  });
});



// API endpoint to update user profile data with image
app.put('/api/users/:userId/profile', verifyToken, upload.single('profileImage'), (req, res) => {
  const userId = req.params.userId;

  // Ensure that the user making the request is the same as the one being updated
  if (req.userId.toString() !== userId) {
    return res.status(403).json({ error: 'You are not authorized to update this profile' });
  }

  // Extract the data from the request body
  const { username, bio, gender } = req.body;
  const profileImage = req.file ? `/uploads/${req.file.filename}` : null; // Check if the image was uploaded

  // Validate that the necessary fields are provided
  if (!username || !bio || !gender) {
    return res.status(400).json({ error: 'All fields are required: username, bio, and gender' });
  }

  // First, check if the username already exists for a different user
  const checkUsernameSql = `
    SELECT id FROM users WHERE username = ? AND id != ?;
  `;

  // Execute the SQL query to check for existing username
  pool.query(checkUsernameSql, [username, userId], (error, results) => {
    if (error) {
      return res.status(500).json({ error: 'Database error while checking username' });
    }

    // If results length > 0, it means the username is already taken by another user
    if (results.length > 0) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // SQL query to update the user's profile
    let updateProfileSql = `
      UPDATE users 
      SET username = ?, bio = ?, gender = ?
    `;

    const updateData = [username, bio, gender, userId];

    // If an image was uploaded, include the profileImage in the update
    if (profileImage) {
      updateProfileSql += `, picture = ?`;
      updateData.splice(3, 0, profileImage); // Insert profileImage into the query parameters
    }

    updateProfileSql += ` WHERE id = ?;`;

    // Execute the SQL query to update the user's profile
    pool.query(updateProfileSql, updateData, (error, results) => {
      if (error) {
        return res.status(500).json({ error: 'Database error while updating user profile' });
      }

      // If no rows were affected, the user was not found
      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Respond with a success message and the profile image URL if updated
      res.json({
        message: 'Profile updated successfully',
        profileImage: profileImage ? profileImage : null
      });
    });
  });
});


// API endpoint to follow or unfollow another user
app.post('/api/users/:userId/follow/:followingId', verifyToken, (req, res) => {
  const userId = req.params.userId;
  const followingId = req.params.followingId;

  // Ensure that the user making the request is the same as the one being followed or unfollowed
  if (req.userId.toString() !== userId) {
    return res.status(403).json({ error: 'You are not authorized to follow or unfollow this user' });
  }

  // Check if the following user exists
  const checkFollowingSql = 'SELECT * FROM users WHERE id = ?';
  pool.query(checkFollowingSql, [followingId], (error, followingResults) => {
    if (error) {
      return res.status(500).json({ error: 'Database error while checking following user' });
    }
    if (followingResults.length === 0) {
      return res.status(404).json({ error: 'User to follow not found' });
    }

    // Check if the user is already following the other user
    const checkFollowSql = 'SELECT * FROM follower_following WHERE follower_id = ? AND following_id = ?';
    pool.query(checkFollowSql, [userId, followingId], (error, followResults) => {
      if (error) {
        return res.status(500).json({ error: 'Database error while checking follow status' });
      }

      if (followResults.length > 0) {
        // User is already following, so unfollow
        const unfollowSql = 'DELETE FROM follower_following WHERE follower_id = ? AND following_id = ?';
        pool.query(unfollowSql, [userId, followingId], (error) => {
          if (error) {
            return res.status(500).json({ error: 'Database error while unfollowing user' });
          }
          return res.status(200).json({ message: 'Unfollowed user successfully' });
        });
      } else {
        // User is not following, so follow
        const followSql = 'INSERT INTO follower_following (follower_id, following_id) VALUES (?, ?)';
        pool.query(followSql, [userId, followingId], (error) => {
          if (error) {
            return res.status(500).json({ error: 'Database error while following user' });
          }
          return res.status(201).json({ message: 'Followed user successfully' });
        });
      }
    });
  });
});










// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
