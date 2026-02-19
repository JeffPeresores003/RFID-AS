const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

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
    });

    parser.on('data', (data) => {
      const trimmedData = data.trim();
      console.log('Received:', trimmedData);
      
      // Try to parse JSON data from Arduino
      try {
        const parsedData = JSON.parse(trimmedData);
        if (parsedData.uid) {
          handleRFIDScan(parsedData.uid);
        }
      } catch (e) {
        // Not JSON, ignore or log for debugging
        if (trimmedData.length > 0 && !trimmedData.startsWith('RFID')) {
          console.log('Non-JSON data:', trimmedData);
        }
      }
    });

    serialPort.on('error', (err) => {
      console.error('Serial port error:', err.message);
    });

  } catch (error) {
    console.error('Error initializing serial port:', error);
  }
}

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
  
  // Find student by UID
  const students = readCSV(STUDENTS_CSV);
  const student = students.find(s => s.card_uid.toLowerCase() === uid.toLowerCase());
  
  if (!student) {
    console.log('⚠️  Unknown card - Not registered');
    const scanData = {
      status: 'error',
      message: 'Card not registered',
      uid: uid,
      timestamp: new Date().toISOString()
    };
    // Broadcast to all SSE clients
    broadcastSSE(scanData);
    return;
  }

  // Check for duplicate scan today
  const attendance = readCSV(ATTENDANCE_CSV);
  const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD format
  
  const alreadyScannedToday = attendance.find(record => 
    record.card_uid && 
    record.card_uid.toLowerCase() === uid.toLowerCase() && 
    record.scanned_at && 
    record.scanned_at.startsWith(today)
  );

  if (alreadyScannedToday) {
    console.log(`⚠️  Duplicate scan prevented: ${student.fullname} already scanned today at ${alreadyScannedToday.scanned_at}`);
    const scanData = {
      status: 'duplicate',
      message: 'Already scanned today',
      student: student,
      previous_scan: alreadyScannedToday.scanned_at,
      timestamp: new Date().toISOString()
    };
    // Broadcast to all SSE clients
    broadcastSSE(scanData);
    return;
  }

  // Record attendance
  const attendanceId = Date.now(); // Simple unique ID
  const timestamp = new Date().toISOString();
  
  const attendanceRecord = {
    id: attendanceId,
    student_id: student.student_id,
    card_uid: uid,
    fullname: student.fullname,
    grade: student.grade,
    section: student.section,
    scanned_at: timestamp
  };

  const headers = ['id', 'student_id', 'card_uid', 'fullname', 'grade', 'section', 'scanned_at'];
  appendToCSV(ATTENDANCE_CSV, attendanceRecord, headers);

  console.log(`✓ Attendance recorded for: ${student.fullname}`);

  const scanData = {
    status: 'success',
    message: 'Attendance recorded',
    student: student,
    timestamp: timestamp
  };

  // Broadcast to all SSE clients
  broadcastSSE(scanData);
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
  const newClient = { id: clientId, res };
  sseClients.push(newClient);
  
  console.log(`Client ${clientId} connected to SSE`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
    console.log(`Client ${clientId} disconnected from SSE`);
  });
});

// ===== API ROUTES =====

// Get all students
app.get('/api/students', (req, res) => {
  const students = readCSV(STUDENTS_CSV);
  res.json(students);
});

// Register new student
app.post('/api/students', (req, res) => {
  const { student_id, card_uid, fullname, grade, section } = req.body;
  
  // Validation
  if (!student_id || !card_uid || !fullname || !grade || !section) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const students = readCSV(STUDENTS_CSV);
  
  // Check for duplicate student ID or card UID
  const duplicateId = students.find(s => s.student_id === student_id);
  const duplicateUid = students.find(s => s.card_uid.toLowerCase() === card_uid.toLowerCase());
  
  if (duplicateId) {
    return res.status(400).json({ error: 'Student ID already exists' });
  }
  
  if (duplicateUid) {
    return res.status(400).json({ error: 'Card UID already registered' });
  }

  const newStudent = {
    student_id,
    card_uid: card_uid.toUpperCase(),
    fullname,
    grade,
    section,
    registered_at: new Date().toISOString()
  };

  const headers = ['student_id', 'card_uid', 'fullname', 'grade', 'section', 'registered_at'];
  appendToCSV(STUDENTS_CSV, newStudent, headers);

  res.json({ message: 'Student registered successfully', student: newStudent });
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
