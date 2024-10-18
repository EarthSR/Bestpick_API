const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const admin = require("firebase-admin");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const multer = require("multer");
require("dotenv").config();
const path = require("path");
const JWT_SECRET = process.env.JWT_SECRET;
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS

// Initialize Firebase Admin SDK
const serviceAccount = require("./config/apilogin-6efd6-firebase-adminsdk-b3l6z-c2e5fe541a.json");
const { title } = require("process");
const { error } = require("console");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Create Connection Pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  connectTimeout: 60000,
  acquireTimeout: 60000,
  ssl: {
    rejectUnauthorized: true, // กำหนดว่าเซิร์ฟเวอร์ต้องมีใบรับรองที่น่าเชื่อถือ
    ca: fs.readFileSync("./certs/isrgrootx1.pem"), // เพิ่มไฟล์ใบรับรอง
  },
});


// ฟังก์ชันสำหรับการเชื่อมต่อใหม่อัตโนมัติ
function reconnect() {
  pool.getConnection((err) => {
    if (err) {
      console.error("Error re-establishing database connection: ", err);
      setTimeout(reconnect, 2000); // ลองเชื่อมต่อใหม่ทุก 2 วินาที
    } else {
      console.log("Database reconnected successfully.");
    }
  });
}

// ตรวจจับข้อผิดพลาดใน Pool และเชื่อมต่อใหม่อัตโนมัติ
pool.on('error', (err) => {
  if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
    console.error("Database connection lost. Reconnecting...");
    reconnect(); // เรียกใช้ reconnect
  } else {
    console.error("Database error: ", err);
    throw err;
  }
});

// ตรวจสอบการเชื่อมต่อเริ่มต้น
pool.getConnection((err, connection) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    return;
  }
  console.log("Connected to the database successfully!");
  connection.release(); // ปล่อยการเชื่อมต่อกลับไปใน Pool
});

module.exports = pool; // Export pool เพื่อให้สามารถใช้งานในไฟล์อื่นๆ ได้
// Verify Token Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(403)
      .json({ error: "No token provided or incorrect format" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id; // Store the user ID for later use
    req.role = decoded.role; // Store the role for later use
    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString("hex");
    const fileExtension = path.extname(file.originalname); // ดึงนามสกุลไฟล์ เช่น .jpg, .png
    const originalName = path.basename(file.originalname, fileExtension); // ดึงชื่อไฟล์ต้นฉบับ
    const timestamp = Date.now(); // เวลาปัจจุบันในหน่วย milliseconds

    // ตั้งชื่อไฟล์ใหม่ด้วย timestamp, original name, unique hash และ extension
    const newFileName = `${timestamp}_${originalName}_${uniqueName}${fileExtension}`;

    // แสดงชื่อไฟล์ใน console log เพื่อตรวจสอบ
    console.log(`File saved as: ${newFileName}`);

    cb(null, newFileName); // บันทึกชื่อไฟล์
  },
});

const upload = multer({
  storage: storage, // เปลี่ยนจาก dest เป็น storage ที่เราสร้างไว้
  limits: {
    fileSize: 10 * 1024 * 1024, // จำกัดขนาดไฟล์ที่อัปโหลด (10MB)
  },
});

// Generate OTP
function generateOtp() {
  const otp = crypto.randomBytes(3).toString("hex"); // 3 bytes = 6 hex characters
  return parseInt(otp, 16).toString().slice(0, 4);
}

function sendOtpEmail(email, otp, callback) {
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.email,
      pass: process.env.emailpassword,
    },
  });

  const mailOptions = {
    from: process.env.email,
    to: email,
    subject: "Your OTP Code",
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
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending OTP email:", error); // Log the error for debugging purposes
      return callback({
        error: "Failed to send OTP email. Please try again later.",
      });
    }
    callback(null, info); // Proceed if the email was successfully sent
  });
}

// Register a new email user
app.post("/register/email", async (req, res) => {
  try {
    const { email } = req.body;
    const checkRegisteredSql =
      "SELECT * FROM users WHERE email = ? AND password IS NOT NULL";

    pool.query(checkRegisteredSql, [email], (err, results) => {
      if (err)
        throw new Error("Database error during email registration check");
      if (results.length > 0)
        return res.status(400).json({ error: "Email already registered" });

      const checkSql =
        "SELECT * FROM users WHERE email = ? AND password IS NULL";
      pool.query(checkSql, [email], (err, results) => {
        if (err) throw new Error("Database error during email check");
        if (results.length > 0)
          return res
            .status(400)
            .json({ error: "Email already in use or used in another sign-in" });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const findOtpSql = "SELECT * FROM otps WHERE email = ?";
        pool.query(findOtpSql, [email], (err, otpResults) => {
          if (err) throw new Error("Database error during OTP retrieval");

          if (otpResults.length > 0) {
            const updateOtpSql =
              "UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?";
            pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
              if (err) throw new Error("Database error during OTP update");
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error("Error sending OTP email");
                res.status(200).json({ message: "OTP sent to email" });
              });
            });
          } else {
            const insertOtpSql =
              "INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)";
            pool.query(insertOtpSql, [email, otp, expiresAt], (err) => {
              if (err) throw new Error("Database error during OTP insertion");
              sendOtpEmail(email, otp, (error) => {
                if (error) throw new Error("Error sending OTP email");
                res.status(200).json({ message: "OTP sent to email" });
              });
            });
          }
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify OTP
app.post("/register/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const verifyOtpSql =
      "SELECT otp, expires_at FROM otps WHERE email = ? AND otp = ?";

    pool.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error("Database error during OTP verification");
      if (results.length === 0)
        return res.status(400).json({ error: "Invalid OTP" });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at))
        return res.status(400).json({ error: "OTP has expired" });

      res
        .status(200)
        .json({ message: "OTP verified, you can set your password now" });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register User
app.post("/register/set-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);

    const sql = "INSERT INTO users (email, password, status, role, username) VALUES (?, ?, 'active', 'user', '')";
    pool.query(sql, [email, hash], (err) => {
      if (err) throw new Error("Database error during registration");

      const deleteOtpSql = "DELETE FROM otps WHERE email = ?";
      pool.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error("Database error during OTP cleanup");
        res.status(201).json({ message: "User registered successfully" });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Resend OTP for Registration
app.post("/resend-otp/register", async (req, res) => {
  try {
    const { email } = req.body;
    const findOtpSql = "SELECT otp, expires_at FROM otps WHERE email = ?";

    pool.query(findOtpSql, [email], (err, results) => {
      if (err) throw new Error("Database error during OTP lookup");
      if (results.length === 0)
        return res
          .status(400)
          .json({
            error: "No OTP found for this email. Please register first.",
          });

      const { otp, expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at)) {
        const newOtp = generateOtp();
        const newExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
        const updateOtpSql =
          "UPDATE otps SET otp = ?, expires_at = ? WHERE email = ?";
        pool.query(updateOtpSql, [newOtp, newExpiresAt, email], (err) => {
          if (err) throw new Error("Database error during OTP update");
          sendOtpEmail(email, newOtp, (error) => {
            if (error) throw new Error("Error sending OTP email");
            res.status(200).json({ message: "New OTP sent to email" });
          });
        });
      } else {
        sendOtpEmail(email, otp, (error) => {
          if (error) throw new Error("Error resending OTP email");
          res.status(200).json({ message: "OTP resent to email" });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Forgot Password
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql =
      "SELECT * FROM users WHERE email = ? AND password IS NOT NULL";

    pool.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error("Database error during email check");
      if (userResults.length === 0)
        return res.status(400).json({ error: "Email not found" });

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const otpCheckSql = "SELECT * FROM password_resets WHERE email = ?";
      pool.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error("Database error during OTP check");

        if (otpResults.length > 0) {
          const updateOtpSql =
            "UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?";
          pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
            if (err) throw new Error("Database error during OTP update");
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error("Error sending OTP email");
              res.status(200).json({ message: "OTP sent to email" });
            });
          });
        } else {
          const saveOtpSql =
            "INSERT INTO password_resets (email, otp, expires_at) VALUES (?, ?, ?)";
          pool.query(saveOtpSql, [email, otp, expiresAt], (err) => {
            if (err) throw new Error("Database error during OTP save");
            sendOtpEmail(email, otp, (error) => {
              if (error) throw new Error("Error sending OTP email");
              res.status(200).json({ message: "OTP sent to email" });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify Reset OTP
app.post("/verify-reset-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp)
      return res.status(400).json({ error: "Email and OTP are required" });

    const verifyOtpSql =
      "SELECT otp, expires_at FROM password_resets WHERE email = ? AND otp = ?";
    pool.query(verifyOtpSql, [email, otp], (err, results) => {
      if (err) throw new Error("Database error during OTP verification");
      if (results.length === 0)
        return res.status(400).json({ error: "Invalid OTP or email" });

      const { expires_at } = results[0];
      const now = new Date();

      if (now > new Date(expires_at))
        return res.status(400).json({ error: "OTP has expired" });

      res
        .status(200)
        .json({ message: "OTP is valid, you can set a new password" });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatePasswordSql = "UPDATE users SET password = ? WHERE email = ?";
    pool.query(updatePasswordSql, [hashedPassword, email], (err) => {
      if (err) throw new Error("Database error during password update");

      const deleteOtpSql = "DELETE FROM password_resets WHERE email = ?";
      pool.query(deleteOtpSql, [email], (err) => {
        if (err) throw new Error("Database error during OTP deletion");
        res
          .status(200)
          .json({ message: "Password has been updated successfully" });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Resend OTP for Reset Password
app.post("/resent-otp/reset-password", async (req, res) => {
  try {
    const { email } = req.body;
    const userCheckSql = "SELECT * FROM users WHERE email = ?";

    pool.query(userCheckSql, [email], (err, userResults) => {
      if (err) throw new Error("Database error during email check");
      if (userResults.length === 0)
        return res.status(400).json({ error: "Email not found" });

      const otpCheckSql = "SELECT * FROM password_resets WHERE email = ?";
      pool.query(otpCheckSql, [email], (err, otpResults) => {
        if (err) throw new Error("Database error during OTP check");
        if (otpResults.length === 0)
          return res
            .status(400)
            .json({ error: "No OTP record found for this email" });

        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const updateOtpSql =
          "UPDATE password_resets SET otp = ?, expires_at = ? WHERE email = ?";
        pool.query(updateOtpSql, [otp, expiresAt, email], (err) => {
          if (err) throw new Error("Database error during OTP update");
          sendOtpEmail(email, otp, (error) => {
            if (error) throw new Error("Error sending OTP email");
            res.status(200).json({ message: "New OTP sent to email" });
          });
        });
      });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Get the user's IP address (optional)
    const ipAddress =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;

    const sql = "SELECT * FROM users WHERE email = ? AND status = 'active'";
    pool.query(sql, [email], (err, results) => {
      if (err) throw new Error("Database error during login");
      if (results.length === 0) {
        return res.status(404).json({ message: "No user found" });
      }

      const user = results[0];

      // Check if the user signed up with Google
      if (user.google_id !== null) {
        return res
          .status(400)
          .json({ message: "Please sign in using Google." });
      }

      // If the user has exceeded failed login attempts, block them for 5 minutes
      if (user.failed_attempts >= 5 && user.last_failed_attempt) {
        const now = Date.now();
        const timeSinceLastAttempt =
          now - new Date(user.last_failed_attempt).getTime();
        if (timeSinceLastAttempt < 300000) {
          // 5 minutes
          return res
            .status(429)
            .json({
              message:
                "Too many failed login attempts. Try again in 5 minutes.",
            });
        }
      }

      // Compare the entered password with the stored hashed password
      bcrypt.compare(password, user.password, (err, isMatch) => {
        if (err) throw new Error("Password comparison error");
        if (!isMatch) {
          // Increment failed attempts and update last_failed_attempt
          const updateFailSql =
            "UPDATE users SET failed_attempts = failed_attempts + 1, last_failed_attempt = NOW() WHERE id = ?";
          pool.query(updateFailSql, [user.id], (err) => {
            if (err) console.error("Error logging failed login attempt:", err);
          });

          const remainingAttempts = 5 - (user.failed_attempts + 1); // +1 for current attempt
          return res
            .status(401)
            .json({
              message: `Email or Password is incorrect. You have ${remainingAttempts} attempts left.`,
            });
        }

        // Reset failed attempts after a successful login
        const resetFailSql =
          "UPDATE users SET failed_attempts = 0, last_login = NOW(), last_login_ip = ? WHERE id = ?";
        pool.query(resetFailSql, [ipAddress, user.id], (err) => {
          if (err)
            throw new Error(
              "Error resetting failed attempts or updating login time."
            );

          // Generate JWT token
          const token = jwt.sign({ id: user.id,role: user.role }, JWT_SECRET);

          // Return successful login response with token and user data
          res.status(200).json({
            message: "Authentication successful",
            token,
            user: {
              id: user.id,
              email,
              username: user.username,
              picture: user.picture,
              last_login: new Date(),
              last_login_ip: ipAddress,
            },
          });
        });
      });
    });
  } catch (error) {
    console.error("Internal error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Set profile route (Profile setup or update)
app.post("/set-profile", verifyToken, upload.single('picture'), (req, res) => {
  const { newUsername, birthday } = req.body;
  const userId = req.userId;
  const picture = req.file ? `/uploads/${req.file.filename}` : null; 

  if (!newUsername || !picture || !birthday) {
    return res.status(400).json({ message: "New username, picture, and birthday are required" });
  }

  // Convert birthday from DD/MM/YYYY to YYYY-MM-DD
  const birthdayParts = birthday.split('/');
  const formattedBirthday = `${birthdayParts[2]}-${birthdayParts[1]}-${birthdayParts[0]}`;

  // Check if the new username is already taken
  const checkUsernameQuery = "SELECT * FROM users WHERE username = ?";
  pool.query(checkUsernameQuery, [newUsername], (err, results) => {
    if (err) {
      console.error("Error checking username: ", err);
      return res.status(500).json({ message: "Database error checking username" });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Update the profile with the new username, picture (with '/uploads/'), and birthday (formatted)
    const updateProfileQuery = "UPDATE users SET username = ?, picture = ?, birthday = ? WHERE id = ?";
    pool.query(updateProfileQuery, [newUsername, picture, formattedBirthday, userId], (err) => {
      if (err) {
        console.error("Error updating profile: ", err);
        return res.status(500).json({ message: "Error updating profile" });
      }

      return res.status(200).json({ message: "Profile set/updated successfully" });
    });
  });
});



// Google Sign-In
app.post("/google-signin", async (req, res) => {
  try {
    const { googleId, email } = req.body;

    // ตรวจสอบว่ามีการส่ง Google ID และ Email เข้ามาหรือไม่
    if (!googleId || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ค้นหาผู้ใช้ที่มี google_id และ status = 'active'
    const checkGoogleIdSql = "SELECT * FROM users WHERE google_id = ? AND status = 'active'";
    pool.query(checkGoogleIdSql, [googleId], (err, googleIdResults) => {
      if (err) throw new Error("Database error during Google ID check");

      if (googleIdResults.length > 0) {
        const user = googleIdResults[0];
        const updateSql = "UPDATE users SET email = ? WHERE google_id = ?";
        pool.query(updateSql, [email, googleId], (err) => {
          if (err) throw new Error("Database error during user update");

          const token = jwt.sign({ id: user.id,role: user.role }, JWT_SECRET);
          return res.json({
            message: "User information updated successfully",
            token,
            user: {
              id: user.id,
              email: user.email,
              picture: user.picture,
              username: user.username,
              google_id: user.google_id,
              role: user.role, // เพิ่มบทบาท
              status: user.status, // เพิ่มสถานะ
            },
          });
        });
      } else {
        // ตรวจสอบว่ามี email นี้ในฐานข้อมูลหรือไม่
        const checkEmailSql = "SELECT * FROM users WHERE email = ?";
        pool.query(checkEmailSql, [email], (err, emailResults) => {
          if (err) throw new Error("Database error during email check");
          if (emailResults.length > 0) {
            return res.status(409).json({
              error: "Email already registered with another account",
            });
          }

          // หากไม่มีผู้ใช้ในระบบ ให้สร้างผู้ใช้ใหม่ด้วย Google ID, email, status และ role
          const insertSql =
            'INSERT INTO users (google_id, email, username, status, role) VALUES (?, ?, "", "active", "user")';
          pool.query(insertSql, [googleId, email], (err, result) => {
            if (err) throw new Error("Database error during user insertion");

            const newUserId = result.insertId;
            const newUserSql = "SELECT * FROM users WHERE id = ?";
            pool.query(newUserSql, [newUserId], (err, newUserResults) => {
              if (err) throw new Error("Database error during new user fetch");

              const newUser = newUserResults[0];
              const token = jwt.sign({ id: user.id,role: user.role }, JWT_SECRET);

              return res.status(201).json({
                message: "User registered and authenticated successfully",
                token,
                user: {
                  id: newUser.id,
                  email: newUser.email,
                  picture: newUser.picture,
                  username: newUser.username,
                  google_id: newUser.google_id,
                  role: newUser.role, // เพิ่มบทบาท
                  status: newUser.status, // เพิ่มสถานะ
                },
              });
            });
          });
        });
      }
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// POST /api/interactions - บันทึกการโต้ตอบใหม่
app.post("/api/interactions", verifyToken, async (req, res) => {
  const { post_id, action_type, content } = req.body;
  const user_id = req.userId; // ดึง userId จาก Token

  // ตรวจสอบข้อมูลที่ส่งมาว่าไม่ว่างเปล่า
  const postIdValue = post_id ? post_id : null;

  if (!user_id || !action_type) {
    return res
      .status(400)
      .json({ error: "Missing required fields: user_id or action_type" });
  }

  const insertSql = `
    INSERT INTO user_interactions (user_id, post_id, action_type, content)
    VALUES (?, ?, ?, ?);
  `;
  const values = [user_id, postIdValue, action_type, content || null];

  pool.query(insertSql, values, (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Error saving interaction" });
    }
    res
      .status(201)
      .json({
        message: "Interaction saved successfully",
        interaction_id: results.insertId,
      });
  });
});

// GET /api/interactions - ดึงข้อมูลการโต้ตอบทั้งหมด
app.get("/api/interactions", verifyToken, async (req, res) => {
  const fetchSql = `
    SELECT 
        ui.id, 
        u.username, 
        p.content AS post_content, 
        ui.action_type, 
        ui.content AS interaction_content, 
        ui.created_at 
    FROM user_interactions ui
    JOIN users u ON ui.user_id = u.id
    JOIN posts p ON ui.post_id = p.id
    ORDER BY ui.created_at DESC;
  `;

  pool.query(fetchSql, (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Error fetching interactions" });
    }
    res.json(results);
  });
});

// GET /api/interactions/user/:userId - ดึงข้อมูลการโต้ตอบของผู้ใช้แต่ละคน
app.get("/api/interactions/user/:userId", verifyToken, async (req, res) => {
  const { userId } = req.params;

  if (parseInt(req.userId) !== parseInt(userId)) {
    return res
      .status(403)
      .json({ error: "Unauthorized access: User ID does not match" });
  }

  const fetchUserInteractionsSql = `
    SELECT 
        ui.id, 
        u.username, 
        p.content AS post_content, 
        ui.action_type, 
        ui.content AS interaction_content, 
        ui.created_at 
    FROM user_interactions ui
    JOIN users u ON ui.user_id = u.id
    JOIN posts p ON ui.post_id = p.id
    WHERE ui.user_id = ?
    ORDER BY ui.created_at DESC;
  `;

  pool.query(fetchUserInteractionsSql, [userId], (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res
        .status(500)
        .json({ error: "Error fetching user interactions" });
    }
    res.json(results);
  });
});

// DELETE /api/interactions/:id - ลบข้อมูลการโต้ตอบตาม ID
app.delete("/api/interactions/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  const deleteSql =
    "DELETE FROM user_interactions WHERE id = ? AND user_id = ?";
  pool.query(deleteSql, [id, req.userId], (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Error deleting interaction" });
    }

    if (results.affectedRows === 0) {
      return res
        .status(404)
        .json({
          message:
            "Interaction not found or you are not authorized to delete this interaction",
        });
    }

    res.json({ message: "Interaction deleted successfully" });
  });
});

// PUT /api/interactions/:id - อัปเดตข้อมูลการโต้ตอบตาม ID
app.put("/api/interactions/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { action_type, content } = req.body;

  const updateSql = `
    UPDATE user_interactions 
    SET action_type = ?, content = ?, updated_at = NOW() 
    WHERE id = ? AND user_id = ?;
  `;
  const values = [action_type, content || null, id, req.userId];

  pool.query(updateSql, values, (error, results) => {
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ error: "Error updating interaction" });
    }

    if (results.affectedRows === 0) {
      return res
        .status(404)
        .json({
          message:
            "Interaction not found or you are not authorized to update this interaction",
        });
    }

    res.json({ message: "Interaction updated successfully" });
  });
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
app.get("/api/checkLikeStatus/:postId/:userId", verifyToken, (req, res) => {
  const { postId, userId } = req.params;
  const user_id = req.userId;

  // ตรวจสอบสิทธิ์ว่าผู้ใช้มีสิทธิ์ในการเข้าถึงหรือไม่
  if (user_id != userId) {
    return res
      .status(403)
      .json({ error: "Unauthorized access: User ID does not match" });
  }

  // ตรวจสอบว่า postId และ userId มีค่า
  if (!postId || !userId) {
    return res
      .status(400)
      .json({ error: "Missing required parameters: postId or userId" });
  }

  // SQL Query เพื่อเช็คสถานะการกดไลค์ในตาราง likes
  const query = `
    SELECT COUNT(*) AS isLiked
    FROM likes 
    WHERE post_id = ? AND user_id = ?
  `;

  pool.query(query, [postId, userId], (err, results) => {
    if (err) {
      console.error("Database error during like status check:", err);
      return res
        .status(500)
        .json({ error: "Internal server error during like status check" });
    }

    // ตรวจสอบสถานะการกดไลค์ (ถ้าผลลัพธ์มากกว่า 0 แสดงว่ามีการกดไลค์)
    const isLiked = results[0].isLiked > 0;
    res.json({ isLiked });
  });
});

// View All Posts with Token Verification
app.get("/posts", verifyToken, (req, res) => {
  try {
    const userId = req.userId; // ดึง user_id จาก token ที่ผ่านการตรวจสอบแล้ว

    const query = `
      SELECT posts.*, users.username, users.picture, 
      (SELECT COUNT(*) FROM likes WHERE post_id = posts.id AND user_id = ?) AS is_liked
      FROM posts 
      JOIN users ON posts.user_id = users.id
      WHERE posts.status = 'active' 
    `;

    pool.query(query, [userId], (err, results) => {
      if (err) {
        console.error("Database error during posts retrieval:", err);
        return res
          .status(500)
          .json({ error: "Internal server error during posts retrieval" });
      }

      const parsedResults = results.map((post) => {
        const photoUrls = Array.isArray(post.photo_url)
          ? post.photo_url.map((photo) => photo)
          : [];
        const videoUrls = Array.isArray(post.video_url)
          ? post.video_url.map((video) => video)
          : [];

        return {
          id: post.id,
          userId: post.user_id,
          title: post.Title,
          content: post.content,
          time: post.time,
          updated: post.updated_at,
          photo_url: photoUrls,
          video_url: videoUrls,
          userName: post.username,
          userProfileUrl: post.picture ? post.picture : null,
        };
      });

      res.json(parsedResults);
    });
  } catch (error) {
    console.error("Internal server error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

//update status posts
app.put("/posts/:id/status", verifyToken, (req, res) => {
  const postId = req.params.id;
  const roles = req.role;

  // ตรวจสอบบทบาท (role) และหยุดการทำงานถ้าบทบาทไม่ถูกต้อง
  if (roles !== "admin") {
    return res.status(403).json({ error: "You do not have permission to update status." });
  }

  // รับค่า status ที่จะอัปเดตมาจาก Body
  const { status } = req.body;

  const query = "UPDATE posts SET status = ? WHERE id = ?";
  pool.query(query, [status, postId], (err, results) => {
    if (err) {
      console.error("Database error during post status update:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    // ตรวจสอบว่ามีการอัปเดตข้อมูลหรือไม่
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: "Post not found or status not changed." });
    }

    res.json({ message: "Post status updated successfully." });
  });
});


// View a Single Post with Like and Comment Count and Show Comments
app.get("/posts/:id", verifyToken, (req, res) => {
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
        console.error("Database error during post retrieval:", err);
        return res
          .status(500)
          .json({ error: "Internal server error during post retrieval" });
      }
      if (postResults.length === 0) {
        return res.status(404).json({ error: "Post not found" });
      }

      const post = postResults[0];
      post.photo_url = isValidJson(post.photo_url)
        ? JSON.parse(post.photo_url)
        : [post.photo_url];
      post.video_url = isValidJson(post.video_url)
        ? JSON.parse(post.video_url)
        : [post.video_url];
      post.is_liked = post.is_liked > 0; // แปลงค่า is_liked ให้เป็น boolean

      pool.query(queryComments, [id], (err, commentResults) => {
        if (err) {
          console.error("Database error during comments retrieval:", err);
          return res
            .status(500)
            .json({ error: "Internal server error during comments retrieval" });
        }

        res.json({
          ...post,
          like_count: post.like_count,
          productName: post.ProductName,
          comment_count: post.comment_count,
          update: post.updated_at,
          is_liked: post.is_liked, // เพิ่มสถานะการไลค์ของผู้ใช้ในข้อมูลโพสต์
          comments: commentResults.map((comment) => ({
            id: comment.id,
            user_id: comment.user_id,
            content: comment.comment_text,
            created_at: comment.created_at,
            username: comment.username,
            user_profile: comment.user_profile ? comment.user_profile : null,
          })),
        });
      });
    });
  } catch (error) {
    console.error("Internal server error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});




// Create a Post
app.post(
  "/posts/create",
  verifyToken,
  upload.fields([
    { name: "photo", maxCount: 10 },
    { name: "video", maxCount: 10 },
  ]),
  (req, res) => {
    try {
      const { user_id, content, category, Title, ProductName } = req.body; 
      let photo_urls = [];
      let video_urls = [];

      // ตรวจสอบการสร้างโพสต์โดยผู้ใช้ที่ถูกต้อง
      if (parseInt(req.userId) !== parseInt(user_id)) {
        return res.status(403).json({
          error: "You are not authorized to create a post for this user",
        });
      }

      // รับ URL ของรูปภาพที่อัปโหลด
      if (req.files["photo"]) {
        photo_urls = req.files["photo"].map((file) => `/uploads/${file.filename}`);
      }

      // รับ URL ของวิดีโอที่อัปโหลด
      if (req.files["video"]) {
        video_urls = req.files["video"].map((file) => `/uploads/${file.filename}`);
      }

      const photo_urls_json = JSON.stringify(photo_urls);
      const video_urls_json = JSON.stringify(video_urls);

      const query =
        "INSERT INTO posts (user_id, content, video_url, photo_url, CategoryID, Title, ProductName) VALUES (?, ?, ?, ?, ?, ?, ?)";
      pool.query(
        query,
        [user_id, content, video_urls_json, photo_urls_json, category, Title, ProductName],
        (err, results) => {
          if (err) {
            console.error("Database error during post creation:", err);
            return res.status(500).json({ error: "Database error during post creation" });
          }
          res.status(201).json({
            post_id: results.insertId,
            user_id,
            content,
            category,
            Title,
            ProductName, // ส่งค่ากลับไปเพื่อแสดงผล
            video_urls,
            photo_urls,
          });
        }
      );
    } catch (error) {
      console.error("Internal server error:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);


// Update a Post
app.put(
  "/posts/:id",
  verifyToken,
  upload.fields([
    { name: "photo", maxCount: 10 },
    { name: "video", maxCount: 10 },
  ]),
  (req, res) => {
    try {
      const { id } = req.params;
      const { content, user_id } = req.body;
      let photo_urls = [];
      let video_urls = [];

      // Ensure the user is updating their own post
      if (parseInt(req.userId) !== parseInt(user_id)) {
        return res
          .status(403)
          .json({ error: "You are not authorized to update this post" });
      }

      // Get uploaded photo URLs
      if (req.files["photo"]) {
        photo_urls = req.files["photo"].map(
          (file) => `/uploads/${file.filename}`
        );
      }

      // Get uploaded video URLs
      if (req.files["video"]) {
        video_urls = req.files["video"].map(
          (file) => `/uploads/${file.filename}`
        );
      }

      // Convert arrays to JSON strings for storage
      const photo_urls_json = JSON.stringify(photo_urls);
      const video_urls_json = JSON.stringify(video_urls);

      const query =
        "UPDATE posts SET content = ?, video_url = ?, photo_url = ?, updated_at = NOW() WHERE post_id = ? AND user_id = ?";
      pool.query(
        query,
        [content, video_urls_json, photo_urls_json, id, user_id],
        (err, results) => {
          if (err) {
            console.error("Database error during post update:", err);
            return res
              .status(500)
              .json({ error: "Database error during post update" });
          }
          if (results.affectedRows === 0) {
            return res
              .status(404)
              .json({ error: "Post not found or you are not the owner" });
          }
          res.json({
            post_id: id,
            content,
            video_urls: video_urls,
            photo_urls: photo_urls,
          });
        }
      );
    } catch (error) {
      console.error("Internal server error:", error.message);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Delete a Post
app.delete("/posts/:id", verifyToken, (req, res) => {
  const { id } = req.params;
  const user_id = req.userId; // Get user ID from the token

  // Check if the post belongs to the user
  const postCheckSql = "SELECT * FROM posts WHERE id = ? AND user_id = ?";
  pool.query(postCheckSql, [id, user_id], (postError, postResults) => {
      if (postError) {
          console.error("Database error during post check:", postError);
          return res.status(500).json({ error: "Database error during post check" });
      }
      if (postResults.length === 0) {
          return res.status(404).json({ error: "Post not found or you are not the owner" });
      }

      // Delete notifications related to the post
      const deleteNotificationsSql = "DELETE FROM notifications WHERE post_id = ?";
      pool.query(deleteNotificationsSql, [id], (deleteNotificationError) => {
          if (deleteNotificationError) {
              console.error("Database error during notification deletion:", deleteNotificationError);
              return res.status(500).json({ error: "Database error during notification deletion" });
          }

          // Delete the post
          const deletePostSql = "DELETE FROM posts WHERE id = ? AND user_id = ?";
          pool.query(deletePostSql, [id, user_id], (deletePostError, deletePostResults) => {
              if (deletePostError) {
                  console.error("Database error during post deletion:", deletePostError);
                  return res.status(500).json({ error: "Database error during post deletion" });
              }

              if (deletePostResults.affectedRows === 0) {
                  return res.status(404).json({ error: "Post not found or you are not the owner" });
              }

              res.json({ message: "Post deleted successfully" });
          });
      });
  });
});


app.get("/type", verifyToken, (req, res) => {
  const sqlQuery = "SELECT * FROM category";

  // Get a connection from the pool and query the database
  pool.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ error: "Error connecting to the database" });
    }

    // Execute the query
    connection.query(sqlQuery, (err, result) => {
      // Release the connection back to the pool after query execution
      connection.release();

      if (err) {
        return res.status(500).json({ error: "Database query failed" });
      }

      // Send back the results
      res.json(result);
    });
  });
});



// API สำหรับกด like หรือ unlike โพสต์
app.post("/posts/like/:id", verifyToken, (req, res) => {
  const { id } = req.params; // Post ID จาก URL
  const { user_id } = req.body; // User ID จาก body ของ request

  try {
    // ตรวจสอบว่า userId ใน token ตรงกับ user_id ใน body หรือไม่
    if (parseInt(req.userId) !== parseInt(user_id)) {
      return res
        .status(403)
        .json({ error: "You are not authorized to like this post" });
    }

    // ตรวจสอบว่าโพสต์นั้นมีอยู่ในฐานข้อมูลหรือไม่
    const checkPostSql = "SELECT * FROM posts WHERE id = ?";
    pool.query(checkPostSql, [id], (err, postResults) => {
      if (err) {
        console.error("Database error during post check:", err);
        return res
          .status(500)
          .json({ error: "Database error during post check" });
      }
      if (postResults.length === 0) {
        return res.status(404).json({ error: "Post not found" });
      }

      // ตรวจสอบว่า user ได้กด like โพสต์นี้แล้วหรือยัง
      const checkLikeSql =
        "SELECT * FROM likes WHERE post_id = ? AND user_id = ?";
      pool.query(checkLikeSql, [id, user_id], (err, likeResults) => {
        if (err) {
          console.error("Database error during like check:", err);
          return res
            .status(500)
            .json({ error: "Database error during like check" });
        }

        if (likeResults.length > 0) {
          // ถ้าผู้ใช้กด like แล้ว ให้ unlike (ลบ like ออก)
          const unlikeSql =
            "DELETE FROM likes WHERE post_id = ? AND user_id = ?";
          pool.query(unlikeSql, [id, user_id], (err) => {
            if (err) {
              console.error("Database error during unlike:", err);
              return res
                .status(500)
                .json({ error: "Database error during unlike" });
            }

            // หลังจาก unlike เสร็จ ให้ดึงค่า likeCount ใหม่
            const likeCountQuery =
              "SELECT COUNT(*) AS likeCount FROM likes WHERE post_id = ?";
            pool.query(likeCountQuery, [id], (err, countResults) => {
              if (err) {
                console.error("Database error during like count:", err);
                return res
                  .status(500)
                  .json({ error: "Database error during like count" });
              }
              const likeCount = countResults[0].likeCount;
              res
                .status(200)
                .json({
                  message: "Post unliked successfully",
                  status: "unliked",
                  liked: false,
                  likeCount,
                });
            });
          });
        } else {
          // ถ้ายังไม่กด like ให้เพิ่มการ like
          const likeSql = "INSERT INTO likes (post_id, user_id) VALUES (?, ?)";
          pool.query(likeSql, [id, user_id], (err) => {
            if (err) {
              console.error("Database error during like:", err);
              return res
                .status(500)
                .json({ error: "Database error during like" });
            }

            // หลังจาก like เสร็จ ให้ดึงค่า likeCount ใหม่
            const likeCountQuery =
              "SELECT COUNT(*) AS likeCount FROM likes WHERE post_id = ?";
            pool.query(likeCountQuery, [id], (err, countResults) => {
              if (err) {
                console.error("Database error during like count:", err);
                return res
                  .status(500)
                  .json({ error: "Database error during like count" });
              }
              const likeCount = countResults[0].likeCount;
              res
                .status(201)
                .json({
                  message: "Post liked successfully",
                  status: "liked",
                  liked: true,
                  likeCount,
                });
            });
          });
        }
      });
    });
  } catch (error) {
    console.error("Internal server error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Serve static files (uploaded images and videos)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Search API with grouped results by username, and include only the first photo_url
app.get("/search", (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  // Trim the query to remove any leading/trailing spaces and convert it to lowercase
  const searchValue = `%${query.trim().toLowerCase()}%`;

  // SQL query to search posts by content, title, or username, and include user_id, post_id, title, and photo_url
  const searchSql = `
    SELECT 
      u.id AS user_id,                -- Include user ID
      u.username, 
      u.picture,
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

  pool.query(
    searchSql,
    [searchValue, searchValue, searchValue],
    (err, results) => {
      if (err) {
        console.error("Database error during search:", err);
        return res.status(500).json({ error: "Internal server error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "No results found" });
      }

      // Group the results by username and aggregate their posts
      const groupedResults = results.reduce((acc, post) => {
        const username = post.username;

        // ตรวจสอบประเภทของ photo_url และแปลงเป็นสตริงถ้าจำเป็น
        let photoUrlString = "";
        if (post.photo_url) {
          // กรณี photo_url เป็น object เช่น ถูกดึงมาเป็น JSON object แทน string
          if (typeof post.photo_url === "object") {

            // ลองแปลงเป็นสตริง JSON
            try {
              photoUrlString = JSON.stringify(post.photo_url);
            } catch (e) {
              photoUrlString = ""; // ถ้าไม่สามารถแปลงได้ ให้เป็นค่าว่าง
            }
          } else if (Buffer.isBuffer(post.photo_url)) {
            photoUrlString = post.photo_url.toString(); // แปลง Buffer เป็นสตริง
          } else if (typeof post.photo_url === "string") {
            photoUrlString = post.photo_url; // หากเป็นสตริงอยู่แล้วให้ใช้ได้เลย
          } else {
            console.warn(
              `Unexpected type for photo_url: ${typeof post.photo_url}`
            );
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
              firstPhotoUrl = photoArray[0]; // ดึงเฉพาะรูปภาพแรกจากอาร์เรย์
            }
          } else {
            // ถ้า photo_url เป็นสตริงธรรมดาที่คั่นด้วยจุลภาค
            const photoArray = photoUrlString.split(",");
            firstPhotoUrl = photoArray[0]; // ดึงเฉพาะรูปภาพแรกจากการแยกสตริง
          }
        } catch (e) {
          firstPhotoUrl = ""; // กรณีที่ photo_url ไม่สามารถแปลงได้ ให้เป็นค่าว่าง
        }

        // Check if the username already exists in the accumulator (grouped results)
        const existingUser = acc.find((user) => user.username === username);

        if (existingUser) {
          // If the username exists, add the post information to their posts array
          existingUser.posts.push({
            post_id: post.post_id, // Add post_id to the post object
            title: post.title, // Include title in the post object
            content_preview: post.content_preview,
            photo_url: firstPhotoUrl, // Include only the first photo_url
          });
        } else {
          // If the username does not exist, create a new entry for the user
          acc.push({
            user_id: post.user_id, // Include user_id in the user object
            username: post.username,
            profile_image: post.picture,
            posts: [
              {
                post_id: post.post_id, // Add post_id to the post object
                title: post.title, // Include title in the post object
                content_preview: post.content_preview,
                photo_url: firstPhotoUrl, // Include only the first photo_url
              },
            ],
          });
        }

        return acc;
      }, []); // Start with an empty array for grouping

      // ส่งข้อมูล groupedResults กลับในรูปแบบ JSON
      res.json({ results: groupedResults });
    }
  );
});

app.get("/api/users/:userId/profile", verifyToken, (req, res) => {
  const userId = req.params.userId;

  if (req.userId.toString() !== userId) {
    return res
      .status(403)
      .json({ error: "You are not authorized to view this profile" });
  }

  // SQL query to get user profile and count posts
  const sql = `
      SELECT 
      u.id AS userId, 
      u.username, 
      u.picture AS profileImageUrl,
      u.bio,
      u.email,
      u.birthday,
      u.gender, 
      COUNT(p.id) AS post_count,
      (SELECT COUNT(*) FROM follower_following WHERE following_id = u.id) AS follower_count, 
      (SELECT COUNT(*) FROM follower_following WHERE follower_id = u.id) AS following_count   
      FROM users u
      LEFT JOIN posts p ON p.user_id = u.id
      WHERE u.id = ?
      GROUP BY u.id;
  `;

  // SQL query to get user posts
  const postSql = `
    SELECT 
      p.id AS post_id, 
      p.content, 
      p.photo_url, 
      p.video_url, 
      p.updated_at,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
    FROM posts p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC;
  `;

  // Execute the first query to get user profile
  pool.query(sql, [userId], (error, results) => {
    if (error) {
      return res
        .status(500)
        .json({ error: "Database error while fetching user profile" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userProfile = results[0];

    // Execute the second query to get user's posts
    pool.query(postSql, [userId], (postError, postResults) => {
      if (postError) {
        return res
          .status(500)
          .json({ error: "Database error while fetching user posts" });
      }

      // Construct the response
      const response = {
        userId: userProfile.userId,
        email: userProfile.email,
        username: userProfile.username,
        birthday: userProfile.birthday,
        profileImageUrl: userProfile.profileImageUrl,
        followerCount: userProfile.follower_count,
        followingCount: userProfile.following_count,
        postCount: userProfile.post_count,
        gender: userProfile.gender,
        bio: userProfile.bio,
        posts: postResults.map(post => ({
          post_id: post.post_id,
          content: post.content,
          photoUrl: post.photo_url,
          videoUrl: post.video_url,
          updatedAt: post.updated_at,
          likeCount: post.like_count,
          commentCount: post.comment_count
        }))
      };

      // Send the response
      res.json(response);
    });
  });
});


// ดูโปรไฟล์
app.get("/api/users/:userId/view-profile", verifyToken, (req, res) => {
  const { userId } = req.params;

  const profileSql = `
    SELECT 
      u.id AS userId, 
      u.username, 
      u.picture AS profileImageUrl,
      u.bio,
      u.gender, 
      COUNT(p.id) AS post_count,
      (SELECT COUNT(*) FROM follower_following WHERE following_id = u.id) AS follower_count, 
      (SELECT COUNT(*) FROM follower_following WHERE follower_id = u.id) AS following_count   
    FROM users u
    LEFT JOIN posts p ON p.user_id = u.id
    WHERE u.id = ?
    GROUP BY u.id;
  `;

  const postSql = `
    SELECT 
      p.id AS post_id, 
      p.content, 
      p.photo_url, 
      p.video_url, 
      p.updated_at,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count
    FROM posts p
    WHERE p.user_id = ?
    ORDER BY p.updated_at DESC;
  `;

  pool.query(profileSql, [userId], (error, profileResults) => {
    if (error) {
      return res
        .status(500)
        .json({ error: "Database error while fetching user profile" });
    }
    if (profileResults.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userProfile = profileResults[0];

    pool.query(postSql, [userId], (postError, postResults) => {
      if (postError) {
        console.error("Database error while fetching user posts:", postError);
        return res
          .status(500)
          .json({ error: "Database error while fetching user posts" });
      }

      // ตรวจสอบและแปลง photo_url และ video_url ให้เป็น JSON Array
      const formattedPosts = postResults.map((post) => {
        let photos = [];
        let videos = [];

        // ตรวจสอบว่า `photo_url` เป็นอาร์เรย์อยู่แล้วหรือไม่
        if (Array.isArray(post.photo_url)) {
          photos = post.photo_url; // หากเป็นอาร์เรย์ ให้ใช้ข้อมูลตรง ๆ
        } else if (typeof post.photo_url === "string") {
          try {
            photos = JSON.parse(post.photo_url); // กรณีที่เป็นสตริง JSON Array ให้แปลงเป็นอาร์เรย์
          } catch (e) {
            console.error("Error parsing photo_url:", e.message);
          }
        }

        // ตรวจสอบว่า `video_url` เป็นอาร์เรย์อยู่แล้วหรือไม่
        if (Array.isArray(post.video_url)) {
          videos = post.video_url; // หากเป็นอาร์เรย์ ให้ใช้ข้อมูลตรง ๆ
        } else if (typeof post.video_url === "string") {
          try {
            videos = JSON.parse(post.video_url); // กรณีที่เป็นสตริง JSON Array ให้แปลงเป็นอาร์เรย์
          } catch (e) {
            console.error("Error parsing video_url:", e.message);
          }
        }

        return {
          post_id: post.post_id,
          content: post.content,
          created_at: post.updated_at,
          like_count: post.like_count,
          comment_count: post.comment_count,
          photos, // ส่งกลับ photos ที่ถูกแปลงเป็น Array แล้ว
          videos, // ส่งกลับ videos ที่ถูกแปลงเป็น Array แล้ว
        };
      });

      res.json({
        userId: userProfile.userId,
        username: userProfile.username,
        profileImageUrl: userProfile.profileImageUrl,
        followerCount: userProfile.follower_count,
        followingCount: userProfile.following_count,
        postCount: userProfile.post_count,
        gender: userProfile.gender,
        bio: userProfile.bio,
        posts: formattedPosts,
      });
    });
  });
});

app.put(
  "/api/users/:userId/profile",
  verifyToken,
  upload.single("profileImage"),
  (req, res) => {
    const userId = req.params.userId;

    // Extract the data from the request body
    let { username, bio, gender, birthday } = req.body;
    const profileImage = req.file ? `/uploads/${req.file.filename}` : null;

    // Validate that the necessary fields are provided
    if (!username || !bio || !gender || !birthday) {
      return res
        .status(400)
        .json({ error: "All fields are required: username, bio, gender, and birthday" });
    }

    // Check if birthday is valid and in the correct format
    if (isNaN(Date.parse(birthday))) {
      return res.status(400).json({ error: "Invalid birthday format" });
    }

    // Convert the birthday to the format "yyyy-MM-dd"
    birthday = formatDateForSQL(birthday); // This function should correctly format the date

    // Check if the username is already in use by another user
    const checkUsernameSql = `SELECT id FROM users WHERE username = ? AND id != ?`;

    pool.query(checkUsernameSql, [username, userId], (checkError, checkResults) => {
      if (checkError) {
        console.error("Error checking username:", checkError); // Logging the error
        return res.status(500).json({ error: "Database error while checking username" });
      }

      if (checkResults.length > 0) {
        // Username is already taken by another user
        return res.status(400).json({ error: "Username is already in use" });
      }

      // SQL query to update the user's profile
      let updateProfileSql = `UPDATE users SET username = ?, bio = ?, gender = ?, birthday = ?`;
      const updateData = [username, bio, gender, birthday];

      // If an image was uploaded, include the profileImage in the update
      if (profileImage) {
        updateProfileSql += `, picture = ?`;
        updateData.push(profileImage); // Insert profileImage into the query parameters
      }

      updateProfileSql += ` WHERE id = ?;`;
      updateData.push(userId); // Add the userId at the end of the updateData array

      // Execute the SQL query to update the user's profile
      pool.query(updateProfileSql, updateData, (error, results) => {
        if (error) {
          console.error("Error updating profile:", error); // Logging the error
          return res.status(500).json({ error: "Database error while updating user profile" });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: "User not found" });
        }

        // Respond with a success message and the profile image URL
        res.json({
          message: "Profile updated successfully",
          profileImage: profileImage || "No image uploaded", // Ensure null image is handled correctly
        });
      });
    });
  }
);

// Helper function to format the birthday for SQL (YYYY-MM-DD)
function formatDateForSQL(dateString) {
  const dateObj = new Date(dateString);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0'); // Ensure 2 digits
  const day = String(dateObj.getDate()).padStart(2, '0'); // Ensure 2 digits
  return `${year}-${month}-${day}`;
}




// API endpoint to follow or unfollow another user
app.post("/api/users/:userId/follow/:followingId", verifyToken, (req, res) => {
  const userId = req.params.userId;
  const followingId = req.params.followingId;

  // Ensure that the user making the request is the same as the one being followed or unfollowed
  if (req.userId.toString() !== userId) {
    return res
      .status(403)
      .json({
        error: "You are not authorized to follow or unfollow this user",
      });
  }

  // Check if the following user exists
  const checkFollowingSql = "SELECT * FROM users WHERE id = ?";
  pool.query(checkFollowingSql, [followingId], (error, followingResults) => {
    if (error) {
      return res
        .status(500)
        .json({ error: "Database error while checking following user" });
    }
    if (followingResults.length === 0) {
      return res.status(404).json({ error: "User to follow not found" });
    }

    // Check if the user is already following the other user
    const checkFollowSql =
      "SELECT * FROM follower_following WHERE follower_id = ? AND following_id = ?";
    pool.query(
      checkFollowSql,
      [userId, followingId],
      (error, followResults) => {
        if (error) {
          return res
            .status(500)
            .json({ error: "Database error while checking follow status" });
        }

        if (followResults.length > 0) {
          // User is already following, so unfollow
          const unfollowSql =
            "DELETE FROM follower_following WHERE follower_id = ? AND following_id = ?";
          pool.query(unfollowSql, [userId, followingId], (error) => {
            if (error) {
              return res
                .status(500)
                .json({ error: "Database error while unfollowing user" });
            }
            return res
              .status(200)
              .json({ message: "Unfollowed user successfully" });
          });
        } else {
          // User is not following, so follow
          const followSql =
            "INSERT INTO follower_following (follower_id, following_id) VALUES (?, ?)";
          pool.query(followSql, [userId, followingId], (error) => {
            if (error) {
              return res
                .status(500)
                .json({ error: "Database error while following user" });
            }
            return res
              .status(201)
              .json({ message: "Followed user successfully" });
          });
        }
      }
    );
  });
});


// API endpoint to check follow status of a user
app.get("/api/users/:userId/follow/:followingId/status", verifyToken, (req, res) => {
  const userId = req.params.userId;
  const followingId = req.params.followingId;

  // Ensure that the user making the request is the same as the one being checked
  if (req.userId.toString() !== userId) {
      return res
          .status(403)
          .json({ error: "You are not authorized to check follow status for this user" });
  }

  // Check if the following user exists
  const checkFollowingSql = "SELECT * FROM users WHERE id = ?";
  pool.query(checkFollowingSql, [followingId], (error, followingResults) => {
      if (error) {
          return res.status(500).json({ error: "Database error while checking following user" });
      }
      if (followingResults.length === 0) {
          return res.status(404).json({ error: "User to check follow status not found" });
      }

      // Check if the user is already following the other user
      const checkFollowSql = "SELECT * FROM follower_following WHERE follower_id = ? AND following_id = ?";
      pool.query(
          checkFollowSql,
          [userId, followingId],
          (error, followResults) => {
              if (error) {
                  return res.status(500).json({ error: "Database error while checking follow status" });
              }

              // If the user is following, return true, else return false
              const isFollowing = followResults.length > 0;
              return res.status(200).json({ isFollowing });
          }
      );
  });
});


// api comment
app.post("/posts/:postId/comment", verifyToken, (req, res) => {
  try {
    const { postId } = req.params; // ดึง postId จากพารามิเตอร์
    const { content } = req.body; // ดึงเนื้อหาคอมเมนต์จาก Body
    const userId = req.userId; // ดึง userId จาก Token ที่ผ่านการตรวจสอบแล้ว

    // ตรวจสอบว่าเนื้อหาคอมเมนต์ไม่ว่างเปล่า
    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Comment content cannot be empty" });
    }

    // SQL สำหรับการเพิ่มคอมเมนต์ใหม่ลงในฐานข้อมูล
    const insertCommentSql = `
      INSERT INTO comments (post_id, user_id, comment_text)
      VALUES (?, ?, ?);
    `;

    pool.query(
      insertCommentSql,
      [postId, userId, content],
      (error, results) => {
        if (error) {
          console.error("Database error during comment insertion:", error);
          return res
            .status(500)
            .json({ error: "Error saving comment to the database" });
        }

        res.status(201).json({
          message: "Comment added successfully",
          comment_id: results.insertId,
          post_id: postId,
          user_id: userId,
          content,
        });
      }
    );
  } catch (error) {
    console.error("Internal server error:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// DELETE /posts/:postId/comment/:commentId
app.delete("/posts/:postId/comment/:commentId", verifyToken, (req, res) => {
  const { postId, commentId } = req.params; // Extract postId and commentId from URL parameters
  const userId = req.userId; // Extract userId from the verified token

  // SQL Query to check if the comment exists and belongs to the user
  const checkCommentSql = "SELECT * FROM comments WHERE id = ? AND user_id = ? AND post_id = ?";

  pool.query(checkCommentSql, [commentId, userId, postId], (err, results) => {
    if (err) {
      console.error("Database error during comment check:", err);
      return res.status(500).json({ error: "Error checking comment" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Comment not found or you are not authorized to delete this comment" });
    }

    // SQL Query to delete the comment
    const deleteCommentSql = "DELETE FROM comments WHERE id = ? AND user_id = ? AND post_id = ?";

    pool.query(deleteCommentSql, [commentId, userId, postId], (err, results) => {
      if (err) {
        console.error("Database error during comment deletion:", err);
        return res.status(500).json({ error: "Error deleting comment" });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: "Comment not found or not deleted" });
      }

      // After successfully deleting the comment, delete related notification for that specific comment
      const deleteNotificationSql = "DELETE FROM notifications WHERE comment_id = ?";

      pool.query(deleteNotificationSql, [commentId], (err, notificationResults) => {
        if (err) {
          console.error("Database error during notification deletion:", err);
          return res.status(500).json({ error: "Error deleting notifications" });
        }

        return res.status(200).json({ message: "Comment and associated notification deleted successfully" });
      });
    });
  });
});



app.post("/posts/:postId/bookmark", verifyToken, (req, res) => {
  const { postId } = req.params; // Extract postId from URL parameters
  const userId = req.userId; // Extract userId from the verified token

  // Check if postId is provided
  if (!postId) {
    return res.status(400).json({ error: "Post ID is required" });
  }

  // SQL Query to check if the post is already bookmarked by the user
  const checkBookmarkSql = "SELECT * FROM bookmarks WHERE user_id = ? AND post_id = ?";

  pool.query(checkBookmarkSql, [userId, postId], (err, results) => {
    if (err) {
      console.error("Database error during checking bookmark status:", err);
      return res.status(500).json({ error: "Error checking bookmark status" });
    }

    if (results.length > 0) {
      // If the post is already bookmarked, remove it (unbookmark)
      const removeBookmarkSql = "DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?";
      pool.query(removeBookmarkSql, [userId, postId], (err, deleteResults) => {
        if (err) {
          console.error("Database error during removing bookmark:", err);
          return res.status(500).json({ error: "Error removing bookmark" });
        }
        return res.status(200).json({ message: "Post removed from bookmarks successfully" });
      });
    } else {
      // If the post is not bookmarked, add it
      const addBookmarkSql = "INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)";
      pool.query(addBookmarkSql, [userId, postId], (err, insertResults) => {
        if (err) {
          console.error("Database error during adding bookmark:", err);
          return res.status(500).json({ error: "Error adding post to bookmarks" });
        }
        return res.status(201).json({ message: "Post added to bookmarks successfully" });
      });
    }
  });
});


// API for fetching user's bookmarked posts
app.get("/api/bookmarks", verifyToken, (req, res) => {
  const user_id = req.userId; // Get user_id from token

  // SQL query to fetch bookmarked posts with like and comment counts and follow status
  const fetchBookmarksSql = `
    SELECT 
      p.id AS post_id, 
      p.title,
      p.content, 
      p.photo_url, 
      p.video_url, 
      p.updated_at,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comment_count,
      u.id AS user_id, 
      u.username AS author_username, 
      u.picture AS author_profile_image,
      CASE 
        WHEN (SELECT COUNT(*) 
              FROM follower_following 
              WHERE follower_id = ? AND following_id = u.id) > 0 
        THEN TRUE ELSE FALSE 
      END AS is_following 
    FROM bookmarks b
    JOIN posts p ON b.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC;
  `;

  pool.query(fetchBookmarksSql, [user_id, user_id], (err, results) => {
    if (err) {
      console.error("Database error during fetching bookmarks:", err);
      return res.status(500).json({ error: "Error fetching bookmarks" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "No bookmarks found." });
    }

    // Process photo_url and video_url as JSON arrays and format the response
    const formattedBookmarks = results.map((post) => {
      let photos = [];
      let videos = [];

      // Handle photo_url (if it's a JSON string, parse it into an array)
      if (typeof post.photo_url === "string") {
        try {
          photos = JSON.parse(post.photo_url);
        } catch (e) {
          console.error("Error parsing photo_url:", e.message);
        }
      } else if (Array.isArray(post.photo_url)) {
        photos = post.photo_url;
      }

      // Handle video_url (if it's a JSON string, parse it into an array)
      if (typeof post.video_url === "string") {
        try {
          videos = JSON.parse(post.video_url);
        } catch (e) {
          console.error("Error parsing video_url:", e.message);
        }
      } else if (Array.isArray(post.video_url)) {
        videos = post.video_url;
      }

      return {
        post_id: post.post_id,
        title: post.title,
        content: post.content,
        created_at: post.updated_at,
        like_count: post.like_count,
        comment_count: post.comment_count,
        photos, // formatted photos array
        videos, // formatted videos array
        author: {
          user_id: post.user_id,
          username: post.author_username,
          profile_image: post.author_profile_image,
        },
        is_following: post.is_following === 1, // Convert 1 to true and 0 to false
      };
    });

    // Return the formatted bookmarks
    res.json({ bookmarks: formattedBookmarks });
  });
});





app.post("/api/notifications", verifyToken, (req, res) => {
  const { user_id, post_id, action_type, content, comment_id } = req.body;

  if (!user_id || !action_type) {
    return res.status(400).json({ error: "Missing required fields: user_id or action_type" });
  }

  // ตรวจสอบว่าเป็น action_type อะไร
  if (action_type === 'comment') {
    // สำหรับ comment ให้สร้าง Notification ใหม่ทุกครั้ง
    const insertNotificationSql = `
      INSERT INTO notifications (user_id, post_id, comment_id, action_type, content)
      VALUES (?, ?, ?, ?, ?);
    `;
    const values = [user_id, post_id || null, comment_id || null, action_type, content || null];

    pool.query(insertNotificationSql, values, (error, results) => {
      if (error) {
        console.error("Database error during notification creation:", error);
        return res.status(500).json({ error: "Error creating notification" });
      }
      res.status(201).json({
        message: "Notification created successfully",
        notification_id: results.insertId,
      });
    });
  } else {
    // สำหรับ like หรือ follow ให้ตรวจสอบ Notification เดิมก่อน
    const checkNotificationSql = `
      SELECT id FROM notifications 
      WHERE user_id = ? AND post_id = ? AND action_type = ?;
    `;
    const checkValues = [user_id, post_id || null, action_type];

    pool.query(checkNotificationSql, checkValues, (checkError, checkResults) => {
      if (checkError) {
        console.error("Database error during notification checking:", checkError);
        return res.status(500).json({ error: "Error checking notification" });
      }

      // ถ้าพบ Notification เดิม
      if (checkResults.length > 0) {
        const existingNotificationId = checkResults[0].id;

        // ถ้าเป็น `like` หรือ `follow` ซ้ำ ให้ลบ Notification เดิม
        if (action_type === 'like' || action_type === 'follow') {
          const deleteNotificationSql = `DELETE FROM notifications WHERE id = ?`;
          pool.query(deleteNotificationSql, [existingNotificationId], (deleteError) => {
            if (deleteError) {
              console.error("Database error during notification deletion:", deleteError);
              return res.status(500).json({ error: "Error deleting notification" });
            }
            return res.status(200).json({ message: `${action_type} notification removed successfully` });
          });
        } else {
          return res.status(200).json({ message: "Notification already exists" });
        }
      } else {
        // ถ้าไม่มี Notification เดิม ให้เพิ่ม Notification ใหม่
        const insertNotificationSql = `
          INSERT INTO notifications (user_id, post_id, comment_id, action_type, content)
          VALUES (?, ?, ?, ?, ?);
        `;
        const values = [user_id, post_id || null, comment_id || null, action_type, content || null];

        pool.query(insertNotificationSql, values, (error, results) => {
          if (error) {
            console.error("Database error during notification creation:", error);
            return res.status(500).json({ error: "Error creating notification" });
          }
          res.status(201).json({
            message: "Notification created successfully",
            notification_id: results.insertId,
          });
        });
      }
    });
  }
});





app.get("/api/notifications", verifyToken, (req, res) => {
  const userId = req.userId;

  const fetchActionNotificationsSql = `
  SELECT 
    n.id, 
    n.user_id AS receiver_id, 
    n.post_id, 
    n.comment_id,   
    n.action_type, 
    n.content, 
    n.read_status,
    n.created_at,
    s.username AS sender_name,
    s.picture AS sender_picture, 
    p_owner.username AS receiver_name,
    c.comment_text AS comment_content  
  FROM notifications n
  LEFT JOIN users s ON n.user_id = s.id
  LEFT JOIN posts p ON n.post_id = p.id
  LEFT JOIN users p_owner ON p.user_id = p_owner.id
  LEFT JOIN comments c ON n.post_id = c.post_id AND n.action_type = 'comment' 
  WHERE n.action_type IN ('comment', 'like', 'follow')
    AND p_owner.id = ?
  ORDER BY n.created_at DESC;
  `;

  pool.query(fetchActionNotificationsSql, [userId], (error, results) => {
    if (error) {
      console.error("Database error during fetching notifications:", error);
      return res.status(500).json({ error: "Error fetching notifications" });
    }
    res.json(results);
  });
});




// API สำหรับทำการอ่านของ Notification ตาม ID
app.put("/api/notifications/:id/read", verifyToken, (req, res) => {
  const { id } = req.params;
  const userId = req.userId;


  const updateReadStatusSql = `
    UPDATE notifications
    SET read_status = 1
    WHERE id = ? AND user_id = ?;
  `;

  pool.query(updateReadStatusSql, [id, userId], (error, results) => {
    if (error) {
      console.error("Database error during updating read status:", error);
      return res.status(500).json({ error: "Error updating read status" });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found or you are not the owner" });
    }
    res.json({ message: "Notification marked as read" });
  });
});




// API สำหรับลบ Notification
app.delete("/api/notifications", verifyToken, (req, res) => {
  const { user_id, post_id, action_type } = req.body;

  if (!user_id || !post_id || !action_type) {
    return res
      .status(400)
      .json({ error: "Missing required fields: user_id, post_id, or action_type" });
  }

  const deleteNotificationSql = `
    DELETE FROM notifications 
    WHERE user_id = ? AND post_id = ? AND action_type = ?;
  `;

  pool.query(deleteNotificationSql, [user_id, post_id, action_type], (error, results) => {
    if (error) {
      console.error("Database error during deleting notification:", error);
      return res.status(500).json({ error: "Error deleting notification" });
    }
    res.json({ message: "Notification deleted successfully" });
  });
});


// API สำหรับเพิ่มบุ๊คมาร์ค
app.post("/api/bookmarks", verifyToken, (req, res) => {
  const { post_id } = req.body; // ดึง post_id จาก request body
  const user_id = req.userId; // ดึง user_id จาก Token ที่ผ่านการตรวจสอบแล้ว

  // ตรวจสอบว่ามี post_id ที่ต้องการบุ๊คมาร์คหรือไม่
  if (!post_id) {
    return res.status(400).json({ error: "Post ID is required" });
  }

  // เพิ่มข้อมูลบุ๊คมาร์คในฐานข้อมูล
  const addBookmarkSql = "INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)";
  pool.query(addBookmarkSql, [user_id, post_id], (err, results) => {
    if (err) {
      console.error("Database error during adding bookmark:", err);
      return res.status(500).json({ error: "Error adding bookmark" });
    }

    res.status(201).json({ message: "Post bookmarked successfully" });
  });
});

// API สำหรับลบบุ๊คมาร์ค
app.delete("/api/bookmarks", verifyToken, (req, res) => {
  const { post_id } = req.body; // ดึง post_id จาก request body
  const user_id = req.userId; // ดึง user_id จาก Token ที่ผ่านการตรวจสอบแล้ว

  // ตรวจสอบว่ามี post_id ที่ต้องการลบหรือไม่
  if (!post_id) {
    return res.status(400).json({ error: "Post ID is required" });
  }

  // ลบข้อมูลบุ๊คมาร์คจากฐานข้อมูล
  const deleteBookmarkSql = "DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?";
  pool.query(deleteBookmarkSql, [user_id, post_id], (err, results) => {
    if (err) {
      console.error("Database error during deleting bookmark:", err);
      return res.status(500).json({ error: "Error deleting bookmark" });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ message: "Bookmark not found or you are not authorized to delete" });
    }

    res.json({ message: "Bookmark deleted successfully" });
  });
});

// API สำหรับดึงรายการบุ๊คมาร์คของผู้ใช้
app.get("/api/bookmarks", verifyToken, (req, res) => {
  const user_id = req.userId; // ดึง user_id จาก Token ที่ผ่านการตรวจสอบแล้ว

  // ดึงรายการบุ๊คมาร์คจากฐานข้อมูล
  const fetchBookmarksSql = `
    SELECT 
      b.post_id, 
      p.title, 
      p.content, 
      p.photo_url, 
      p.video_url, 
      u.username AS author 
    FROM bookmarks b
    JOIN posts p ON b.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC;
  `;

  pool.query(fetchBookmarksSql, [user_id], (err, results) => {
    if (err) {
      console.error("Database error during fetching bookmarks:", err);
      return res.status(500).json({ error: "Error fetching bookmarks" });
    }

    res.json(results);
  });
});

app.get("/posts/:postId/bookmark/status", verifyToken, (req, res) => {
  const { postId } = req.params; // Extract postId from URL parameters
  const userId = req.userId; // Extract userId from the verified token

  // SQL Query to check if the post is already bookmarked by the user
  const checkBookmarkSql = "SELECT * FROM bookmarks WHERE user_id = ? AND post_id = ?";

  pool.query(checkBookmarkSql, [userId, postId], (err, results) => {
    if (err) {
      console.error("Database error during checking bookmark status:", err);
      return res.status(500).json({ error: "Error checking bookmark status" });
    }

    // If results are found, post is bookmarked, otherwise it is not
    const isBookmarked = results.length > 0;
    res.status(200).json({ isBookmarked });
  });
});


// API to get posts from followed users
app.get("/api/following/posts", verifyToken, (req, res) => {
  const userId = req.userId; // The logged-in user who is following others

  const getFollowedPostsSql = `
    SELECT 
      p.id AS id, 
      p.user_id AS userId, 
      p.title AS title, 
      p.content AS content, 
      p.photo_url AS photoUrl, 
      p.video_url AS videoUrl, 
      u.username AS userName, 
      u.picture AS userProfileUrl, 
      p.updated_at AS updated, 
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likeCount, 
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS commentCount, 
      EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) AS is_liked
    FROM posts p
    JOIN follower_following f ON p.user_id = f.following_id
    JOIN users u ON p.user_id = u.id
    WHERE f.follower_id = ?
    ORDER BY p.updated_at DESC;
  `;

  pool.query(getFollowedPostsSql, [userId, userId], (error, results) => {
    if (error) {
      return res.status(500).json({ error: "Database error during fetching followed posts." });
    }

    // If there are no followed posts, return an empty array
    if (results.length === 0) {
      return res.status(200).json({ message: "No posts from followed users.", posts: [] });
    }

    // Format the response and send it
    const posts = results.map((post) => ({
      id: post.id,
      userId: post.userId,
      userName: post.userName,
      title: post.title,
      content: post.content,
      photoUrl: Array.isArray(post.photoUrl) ? post.photoUrl : [], // Ensure it's an array
      videoUrl: Array.isArray(post.videoUrl) ? post.videoUrl : [], // Ensure it's an array
      userProfileUrl: post.userProfileUrl,
      time: post.time, // Assuming `created_at` is used as the "time"
      updated: post.updated, 
      is_liked: !!post.is_liked, // Convert to Boolean
      likeCount: post.likeCount || 0,
      commentCount: post.commentCount || 0
    }));

    res.status(200).json({ posts });
  });
});



// API for reporting a post
app.post("/posts/:postId/report", verifyToken, (req, res) => {
  const { postId } = req.params;
  const { reason } = req.body;
  const userId = req.userId; // Extract userId from the token

  // Validate the reason for reporting
  if (!reason || reason.trim() === "") {
    return res.status(400).json({ error: "Report reason is required" });
  }

  // SQL to insert the report into the database
  const insertReportSql = `
    INSERT INTO reports (user_id, post_id, reason)
    VALUES (?, ?, ?);
  `;

  pool.query(insertReportSql, [userId, postId, reason], (error, results) => {
    if (error) {
      console.error("Database error during reporting post:", error);
      return res.status(500).json({ error: "Error reporting post" });
    }

    res.status(201).json({ message: "Post reported successfully" });
  });
});






// API for retrieving all reported posts (admin-only)
app.get("/reports", verifyToken, (req, res) => {
  const role = req.role;

  // Only allow admin to view reports
  if (role !== "admin") {
    return res.status(403).json({ error: "Unauthorized access" });
  }

  const fetchReportsSql = `
    SELECT r.*, u.username AS reported_by, p.title AS post_title
    FROM reports r
    JOIN users u ON r.user_id = u.id
    JOIN posts p ON r.post_id = p.id
    WHERE r.status = 'pending'
    ORDER BY r.reported_at DESC;
  `;

  pool.query(fetchReportsSql, (error, results) => {
    if (error) {
      console.error("Database error during fetching reports:", error);
      return res.status(500).json({ error: "Error fetching reports" });
    }

    res.json(results);
  });
});



// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
