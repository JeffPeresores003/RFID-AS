# RFID Attendance System MVP

A complete RFID-based attendance system using Arduino Uno, RC522 RFID reader, and a web interface.

## 🎯 Features

- **Student Registration**: Register students with ID, name, grade, section, and RFID card UID
- **Real-time RFID Scanning**: Automatic attendance recording when students tap their cards
- **Live Dashboard**: See statistics and recent activity
- **Attendance History**: View, filter, and search attendance records
- **CSV Export**: Export attendance data with filters
- **Mobile-Friendly**: Responsive design works on phones, tablets, and computers

## 📋 Hardware Requirements

- Arduino Uno
- RC522 RFID Reader Module
- RFID Cards/Tags
- Buzzer (connected to pin 8)
- USB Cable to connect Arduino to computer
- Jumper wires

## 🔌 RC522 Wiring to Arduino Uno

| RC522 Pin | Arduino Pin |
|-----------|-------------|
| SDA       | 10          |
| SCK       | 13          |
| MOSI      | 11          |
| MISO      | 12          |
| IRQ       | Not connected |
| GND       | GND         |
| RST       | 9           |
| 3.3V      | 3.3V        |

**Buzzer**: Connect buzzer positive to pin 8, negative to GND

## 💻 Software Requirements

- Arduino IDE (to upload code to Arduino)
- Node.js (version 14 or higher)
- Modern web browser (Chrome, Firefox, Edge)

## 🚀 Setup Instructions

### Step 1: Upload Arduino Code

1. Open Arduino IDE
2. Open the file: `RFID_attendance1/RFID_attendance1.ino`
3. Install required libraries:
   - Go to **Sketch → Include Library → Manage Libraries**
   - Search and install: **MFRC522**
4. Select your board: **Tools → Board → Arduino Uno**
5. Select your port: **Tools → Port → (Select your Arduino's COM port)**
6. Click **Upload** button
7. Once uploaded, **keep the Arduino connected** to the computer

### Step 2: Install Node.js Dependencies

1. Open PowerShell or Command Prompt
2. Navigate to the server folder:
   ```powershell
   cd "c:\Users\JEFFREY PERESORES\Documents\RFID - test\RFID_attendance1\server"
   ```
3. Install dependencies:
   ```powershell
   npm install
   ```

### Step 3: Start the Server

1. In the same terminal, run:
   ```powershell
   npm start
   ```
2. You should see:
   ```
   ✓ Server running at http://localhost:3000
   ✓ Serial port opened successfully
   Ready to accept RFID scans!
   ```

### Step 4: Open the Web Interface

1. Open your web browser
2. Go to: **http://localhost:3000**
3. You should see the Dashboard

## 📖 How to Use

### 1. Register Students

1. Click **"Register"** in the navigation
2. Fill in student information:
   - Student ID (e.g., 2024-001)
   - Full Name
   - Grade (7-12)
   - Section
3. For Card UID:
   - **Option A**: Click **"📡 Scan"** button and tap the RFID card on the reader
   - **Option B**: Manually type the UID (e.g., "61 64 96 17")
4. Click **"✅ Register Student"**

### 2. Scan Attendance

1. Click **"Scanner"** in the navigation
2. Wait for status to show **"Scanner Active"**
3. Students tap their RFID cards on the reader
4. Attendance is automatically recorded
5. Student information will appear on screen with success/error message

### 3. View History

1. Click **"History"** in the navigation
2. By default, shows today's records
3. Use filters to search by:
   - Date
   - Student ID
   - Grade
   - Section
4. Click **"📥 Export CSV"** to download filtered data

### 4. Dashboard

- View statistics (total students, total scans, today's scans)
- See recent scan activity
- Quick access to all features

## 📁 Project Structure

```
RFID_attendance1/
├── RFID_attendance1.ino          # Arduino code
├── server/
│   ├── server.js                 # Node.js backend server
│   ├── package.json              # Node.js dependencies
│   └── data/
│       ├── students.csv          # Student database (CSV)
│       └── attendance.csv        # Attendance records (CSV)
└── public/
    ├── index.html                # Dashboard page
    ├── register.html             # Student registration
    ├── scanner.html              # Real-time scanner
    ├── history.html              # Attendance history
    └── css/
        └── styles.css            # Stylesheet

```

## 🔧 Troubleshooting

### Arduino Not Detected

- Check if Arduino is connected via USB
- Try a different USB port
- Check Device Manager (Windows) to see if Arduino is recognized
- Install Arduino drivers if needed

### Server Won't Start

- Make sure Node.js is installed: `node --version`
- Make sure you're in the server folder
- Delete `node_modules` folder and `package-lock.json`, then run `npm install` again

### RFID Not Reading

- Check wiring connections
- Make sure RC522 is getting 3.3V (NOT 5V!)
- Try different RFID cards
- Check Serial Monitor in Arduino IDE for debugging

### Website Not Loading

- Make sure server is running (should show "Server running at http://localhost:3000")
- Try clearing browser cache
- Check browser console (F12) for errors
- Make sure no other application is using port 3000

### Card UID Format

- The system accepts UIDs in format: "61 64 96 17" or "61649617"
- Uppercase or lowercase works
- Spaces are optional

## 📊 Data Storage

All data is stored in CSV files for easy access:

- **students.csv**: Contains all registered students
- **attendance.csv**: Contains all attendance records

You can open these files with Excel or any text editor.

### Backing Up Data

Simply copy the `server/data/` folder to backup your data.

## 🌟 Tips

1. **Test First**: Register a test student and scan their card to verify everything works
2. **Keep Arduino Connected**: The Arduino must stay connected to the computer while the server is running
3. **Network Access**: For other devices on your network to access the website, replace `localhost` with your computer's IP address
4. **Multiple Scanners**: You can run multiple scanners by connecting multiple Arduinos (modify server code to handle multiple ports)

## 🆘 Need Help?

Check the terminal/console for error messages. Most issues are related to:
- Arduino not connected
- Wrong COM port
- Missing libraries
- Node.js not installed

## 📝 Notes

- This is an MVP (Minimum Viable Product) designed for quick deployment
- Data is stored locally in CSV files (no internet required)
- System uses check-in only mode (single timestamp per scan)
- Designed for classroom/school gate attendance tracking

## 🔄 Future Enhancements (Optional)

- Add check-in/check-out mode
- Add user authentication
- Export to PDF
- SMS/Email notifications
- Cloud database integration
- Multiple location support
- Guardian portal

---

**Built with:** Arduino, Node.js, Express, SerialPort, HTML/CSS/JavaScript
