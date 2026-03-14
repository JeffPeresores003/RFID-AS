const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bzwhewglvcxssnvebliw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jI3byTirl75E51Tg7TAzCA_1aHU8zdx';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Paths to CSV files
const STUDENTS_CSV = path.join(__dirname, 'data', 'students.csv');
const ATTENDANCE_CSV = path.join(__dirname, 'data', 'attendance.csv');

// Store for SSE clients (real-time updates)
let sseClients = [];

// ===== SERIAL PORT SETUP =====
let serialPort = null;
let parser = null;
let reconnectInterval = null;
let isReconnecting = false;
let reconnectAttempts = 0;
const RECONNECT_DELAY = 1500; // 1.5 seconds

function autoResetArduino() {
  if (!serialPort || !serialPort.isOpen) return;

  serialPort.set({ dtr: false }, (err) => {
    if (err) {
      console.log(`DTR low failed: ${err.message}`);
      return;
    }

    setTimeout(() => {
      if (!serialPort || !serialPort.isOpen) return;
      serialPort.set({ dtr: true }, (setErr) => {
        if (setErr) {
          console.log(`DTR high failed: ${setErr.message}`);
          return;
        }
        console.log('✓ Arduino auto-reset triggered (DTR toggle)');
      });
    }, 200);
  });
}

// Function to list available ports
async function listPorts() {
  const ports = await SerialPort.list();
  console.log('\n=== Available Serial Ports ===');
  ports.forEach((port, index) => {
    console.log(`${index + 1}. ${port.path} - ${port.manufacturer || 'Unknown'}`);
  });
  return ports;
}

// Function to initialize serial port
async function initSerialPort() {
  try {
    const ports = await listPorts();
    
    // Try to find Arduino port automatically
    let arduinoPort = ports.find(port => 
      port.manufacturer && (
        port.manufacturer.includes('Arduino') || 
        port.manufacturer.includes('CH340') ||
        port.manufacturer.includes('USB')
      )
    );

    if (!arduinoPort && ports.length > 0) {
      // If no Arduino found, use the first available port
      arduinoPort = ports[0];
      console.log(`\nNo Arduino detected. Using first available port: ${arduinoPort.path}`);
    }

    if (!arduinoPort) {
      console.log('\n⚠️  No serial ports found. Please connect your Arduino.');
      if (!isReconnecting) {
        attemptReconnect();
      }
      return;
    }

    console.log(`\n✓ Connecting to: ${arduinoPort.path}`);
    
    serialPort = new SerialPort({
      path: arduinoPort.path,
      baudRate: 9600
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

    serialPort.on('open', () => {
      console.log('✓ Serial port opened successfully\n');
      autoResetArduino();
      reconnectAttempts = 0; // Reset reconnect attempts on successful connection
      isReconnecting = false;
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
    });

    parser.on('data', (data) => {
      const trimmedData = data.trim();
      console.log('Received:', trimmedData);
      
      // Check if Arduino has been reset and is ready
      if (trimmedData.includes('Scanner ready')) {
        console.log('\u2713 Arduino initialized and ready to scan');
        return;
      }
      
      // Try to parse JSON data from Arduino
      try {
    const parsedData = JSON.parse(trimmedData);
    // Only process scans if at least one SSE client is connected
    if (sseClients.length > 0) {
      handleRFIDScan(parsedData.uid);
    }
    // Optionally: else ignore or buffer scans
  } catch (e) {
        // Not JSON, ignore or log for debugging
        if (trimmedData.length > 0 && !trimmedData.startsWith('RFID')) {
          console.log('Non-JSON data:', trimmedData);
        }
      }
    });

    serialPort.on('close', () => {
      console.log('\n⚠️  Serial port closed (Arduino may have been disconnected or reset)');
      parser = null;
      serialPort = null;
      
      // Attempt to reconnect
      if (!isReconnecting) {
        console.log('Attempting to reconnect...');
        attemptReconnect();
      }
    });

    serialPort.on('error', (err) => {
      console.error('Serial port error:', err.message);
      
      // Handle specific errors
      if (err.message.includes('Access denied') || err.message.includes('cannot open')) {
        console.log('\n⚠️  Port access denied or unavailable. Will retry...');
        if (!isReconnecting) {
          attemptReconnect();
        }
      }
    });

  } catch (error) {
    console.error('Error initializing serial port:', error);
    if (!isReconnecting) {
      attemptReconnect();
    }
  }
}

// Function to attempt reconnection
function attemptReconnect() {
  if (isReconnecting) return;
  
  isReconnecting = true;
  reconnectAttempts++;

  console.log(`Reconnection attempt ${reconnectAttempts} in ${RECONNECT_DELAY/1000} seconds...`);
  
  reconnectInterval = setTimeout(async () => {
    try {
      // Close existing port if any
      if (serialPort && serialPort.isOpen) {
        await serialPort.close();
      }
    } catch (err) {
      // Ignore close errors
    }
    
    serialPort = null;
    parser = null;
    
    await initSerialPort();
  }, RECONNECT_DELAY);
}

// ===== GRACEFUL SHUTDOWN =====

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n\n🛑 Received ${signal}. Shutting down gracefully...`);
  
  // Clear reconnect interval if any
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
  }
  
  // Close all SSE connections
  console.log('Closing SSE connections...');
  sseClients.forEach(client => {
    try {
      client.res.end();
    } catch (err) {
      // Ignore errors when closing
    }
  });
  sseClients = [];
  
  // Close serial port
  if (serialPort && serialPort.isOpen) {
    try {
      console.log('Closing serial port...');
      await serialPort.close();
      console.log('✓ Serial port closed');
    } catch (err) {
      console.error('Error closing serial port:', err.message);
    }
  }
  
  console.log('✓ Cleanup complete. Exiting...\n');
  process.exit(0);
}

// Handle termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('\n❌ Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ===== CSV HELPER FUNCTIONS =====

function readCSV(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  // Handle both Windows (CRLF) and Unix (LF) line endings
  const lines = content.replace(/\r\n/g, '\n').trim().split('\n').filter(line => line.trim().length > 0);
  if (lines.length <= 1) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1)
    .filter(line => line.trim().length > 0)
    .map(line => {
      const values = line.split(',');
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = values[i] ? values[i].trim() : '';
      });
      return obj;
    })
    .filter(obj => obj[headers[0]]); // Filter out objects with empty first field
}

function writeCSV(filePath, data, headers) {
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(h => row[h] || '').join(','))
  ].join('\n');
  fs.writeFileSync(filePath, csvContent + '\n', 'utf-8');
}

function appendToCSV(filePath, row, headers) {
  const csvRow = headers.map(h => row[h] || '').join(',');
  fs.appendFileSync(filePath, csvRow + '\n', 'utf-8');
}

// ===== RFID SCAN HANDLER =====

function handleRFIDScan(uid) {
  console.log(`\n📡 RFID Scanned: ${uid}`);
  // Always broadcast UID for capture (for register.html scan button)
  broadcastSSE({ status: 'capture', uid: uid, timestamp: new Date().toISOString() });

  // Only record attendance if scanning is active (scanner.html)
  // Check if any SSE client has scanning mode enabled
  const scanningClients = sseClients.filter(client => client.scanningActive);
  if (scanningClients.length === 0) {
    // No active scanner, do not record attendance
    return;
  }

  (async () => {
    // Find student by UID using Supabase
    const { data: students, error: studentError } = await supabase
      .from('students')
      .select('*')
      .eq('card_uid', uid);
    const student = students && students.length > 0 ? students[0] : null;

    if (!student) {
      console.log('⚠️  Unknown card - Not registered');
      const scanData = {
        status: 'error',
        message: 'Card not registered',
        uid: uid,
        timestamp: new Date().toISOString()
      };
      broadcastSSE(scanData);
      return;
    }

    // Check for duplicate scan today using Supabase
    const today = new Date().toISOString().split('T')[0];
    const { data: attendance, error: attendanceError } = await supabase
      .from('attendance')
      .select('*')
      .eq('card_uid', uid)
      .gte('scanned_at', today);

    const alreadyScannedToday = attendance && attendance.length > 0 ? attendance[0] : null;

    if (alreadyScannedToday) {
      console.log(`⚠️  Duplicate scan prevented: ${student.fullname} already scanned today at ${alreadyScannedToday.scanned_at}`);
      const scanData = {
        status: 'duplicate',
        message: 'Already scanned today',
        student: student,
        previous_scan: alreadyScannedToday.scanned_at,
        timestamp: new Date().toISOString()
      };
      broadcastSSE(scanData);
      return;
    }

    // Record attendance in Supabase
    const timestamp = new Date().toISOString();
    await supabase
      .from('attendance')
      .insert([{
        student_id: student.student_id,
        card_uid: uid,
        fullname: student.fullname,
        grade: student.grade,
        section: student.section,
        scanned_at: timestamp
      }]);

    console.log(`✓ Attendance recorded for: ${student.fullname}`);

    const scanData = {
      status: 'success',
      message: 'Attendance recorded',
      student: student,
      timestamp: timestamp
    };
    broadcastSSE(scanData);
  })();
}

// ===== SERVER-SENT EVENTS (SSE) for Real-time Updates =====

function broadcastSSE(data) {
  sseClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

app.get('/api/scan-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const clientId = Date.now();
  // By default, scanningActive is false. Frontend must send a message to enable scanning.
  const newClient = { id: clientId, res, scanningActive: false };
  sseClients.push(newClient);
  
  console.log(`Client ${clientId} connected to SSE`);

    // Send clientId to frontend immediately
    newClient.res.write(`data: ${JSON.stringify({ clientId })}\n\n`);

  // Listen for scanning mode toggle from frontend
  req.on('data', chunk => {
    try {
      const msg = chunk.toString();
      if (msg.includes('scanning:true')) {
        newClient.scanningActive = true;
      } else if (msg.includes('scanning:false')) {
        newClient.scanningActive = false;
      }
    } catch (e) {}
  });

  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
    console.log(`Client ${clientId} disconnected from SSE`);
  });
});

  // Endpoint to activate scanning mode for a client
  app.post('/api/scanner/activate', (req, res) => {
    const { clientId } = req.body;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId required' });
    }
    const client = sseClients.find(c => c.id === clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    client.scanningActive = true;
    res.json({ message: 'Scanning activated' });
  });
// ===== API ROUTES =====

// Get all students
app.get('/api/students', (req, res) => {
  const students = readCSV(STUDENTS_CSV);
    (async () => {
      const { data: students, error } = await supabase
        .from('students')
        .select('*');
      if (error) {
        return res.status(500).json({ error: 'Failed to fetch students' });
      }
      res.json(students);
    })();
});

// Register new student
app.post('/api/students', (req, res) => {
  const { student_id, card_uid, fullname, grade, section } = req.body;

  // Validation
  if (!student_id || !card_uid || !fullname || !grade || !section) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  (async () => {
    // Check for duplicate student ID or card UID in Supabase
    const { data: students, error } = await supabase
      .from('students')
      .select('*')
      .or(`student_id.eq.${student_id},card_uid.eq.${card_uid}`);

    if (students && students.find(s => s.student_id === student_id)) {
      return res.status(409).json({ error: 'Student ID already exists' });
    }
    if (students && students.find(s => s.card_uid === card_uid)) {
      return res.status(409).json({ error: 'Card UID already registered' });
    }

    // Add new student to Supabase
    const now = new Date();
    const isoDate = now.toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from('students')
      .insert([{ student_id, card_uid: card_uid.toUpperCase(), fullname, grade, section, registered_date: isoDate }])
      .select('*');

    if (insertError) {
      return res.status(500).json({ error: 'Failed to register student' });
    }
    // Respond with the new student, including registered_date
    res.status(201).json({ message: 'Student registered successfully', student: inserted && inserted.length > 0 ? inserted[0] : null });
  })();
});

// Get attendance history
app.get('/api/attendance', (req, res) => {
  const attendance = readCSV(ATTENDANCE_CSV);
  res.json(attendance.reverse()); // Most recent first
});

// Get attendance history with filters
app.get('/api/attendance/filter', (req, res) => {
  const { date, student_id, grade, section } = req.query;
  let attendance = readCSV(ATTENDANCE_CSV);
  
  // Apply filters with null checks
  if (date) {
    attendance = attendance.filter(a => a.scanned_at && a.scanned_at.startsWith(date));
  }
  if (student_id) {
    attendance = attendance.filter(a => a.student_id && a.student_id === student_id);
  }
  if (grade) {
    attendance = attendance.filter(a => a.grade && a.grade === grade);
  }
  if (section) {
    attendance = attendance.filter(a => a.section && a.section === section);
  }
  
  res.json(attendance.reverse());
});

// Export attendance as CSV
app.get('/api/attendance/export', (req, res) => {
  const { date, student_id, grade, section } = req.query;
  let attendance = readCSV(ATTENDANCE_CSV);
  
  // Apply filters with null checks
  if (date) {
    attendance = attendance.filter(a => a.scanned_at && a.scanned_at.startsWith(date));
  }
  if (student_id) {
    attendance = attendance.filter(a => a.student_id && a.student_id === student_id);
  }
  if (grade) {
    attendance = attendance.filter(a => a.grade && a.grade === grade);
  }
  if (section) {
    attendance = attendance.filter(a => a.section && a.section === section);
  }

  // Format timestamps to local time with AM/PM
  const formattedAttendance = attendance.map(record => {
    const newRecord = { ...record };
    if (record.scanned_at) {
      const date = new Date(record.scanned_at);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12; // Convert to 12-hour format
      const hoursStr = String(hours).padStart(2, '0');
      newRecord.scanned_at = `${year}-${month}-${day}T${hoursStr}:${minutes}:${seconds} ${ampm}`;
    }
    return newRecord;
  });

  const headers = ['id', 'student_id', 'card_uid', 'fullname', 'grade', 'section', 'scanned_at'];
  const csvContent = [
    headers.join(','),
    ...formattedAttendance.map(row => headers.map(h => row[h] || '').join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=attendance_${Date.now()}.csv`);
  res.send(csvContent);
});

// Test endpoint to simulate RFID scan (for testing without Arduino)
app.post('/api/test-scan', (req, res) => {
  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ error: 'UID required' });
  }
  handleRFIDScan(uid);
  res.json({ message: 'Scan simulated' });
});

// Get stats
app.get('/api/stats', (req, res) => {
  const students = readCSV(STUDENTS_CSV);
  const attendance = readCSV(ATTENDANCE_CSV);
  const today = new Date().toISOString().split('T')[0];
  const todayAttendance = attendance.filter(a => a.scanned_at.startsWith(today));
  
  res.json({
    totalStudents: students.length,
    totalScans: attendance.length,
    todayScans: todayAttendance.length
  });
});

// ===== START SERVER =====

app.listen(PORT, async () => {
  console.log('\n========================================');
  console.log('🎓 RFID Attendance System');
  console.log('========================================');
  console.log(`\n✓ Server running at http://localhost:${PORT}`);
  console.log('\nInitializing serial connection...');
  
  await initSerialPort();
  
  console.log('\n========================================');
  console.log('Ready to accept RFID scans!');
  console.log('========================================\n');
});
