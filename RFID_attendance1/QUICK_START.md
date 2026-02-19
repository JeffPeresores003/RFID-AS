# 🚀 Quick Start Guide

## Setup in 4 Easy Steps

### 1️⃣ Upload Arduino Code (2 minutes)

1. Open Arduino IDE
2. Open: `RFID_attendance1.ino`
3. Install library: **Sketch → Include Library → Manage Libraries → Search "MFRC522" → Install**
4. Select: **Tools → Board → Arduino Uno**
5. Select: **Tools → Port → (Your Arduino COM port)**
6. Click **Upload** ⬆️
7. **Keep Arduino connected!**

### 2️⃣ Install Server Dependencies (1 minute)

Open PowerShell in the project folder:

```powershell
cd server
npm install
```

### 3️⃣ Start the Server (10 seconds)

```powershell
npm start
```

Wait for: ✅ **"Server running at http://localhost:3000"**

### 4️⃣ Open Website

Open browser → Go to: **http://localhost:3000**

---

## ✨ First Test

1. **Register a Student**:
   - Click "Register"
   - Fill in details
   - Click "📡 Scan" button
   - Tap RFID card
   - Click "✅ Register Student"

2. **Test Scanning**:
   - Click "Scanner"
   - Tap the card again
   - ✅ Should show success message!

---

## 📍 Where Are My Files?

```
📂 Your Project Folder
  ├─ 📄 RFID_attendance1.ino    ← Upload this to Arduino
  ├─ 📂 server/
  │   ├─ 📄 server.js           ← Run "npm start" here
  │   └─ 📂 data/
  │       ├─ 📄 students.csv    ← Your students database
  │       └─ 📄 attendance.csv  ← Your attendance records
  └─ 📂 public/
      └─ 📄 index.html, etc.    ← Your website files
```

---

## ❌ Common Issues

| Problem | Solution |
|---------|----------|
| "Port busy" | Close Arduino IDE Serial Monitor |
| "No serial ports found" | Reconnect Arduino USB cable |
| "npm not found" | Install Node.js from nodejs.org |
| "Cannot find module" | Run `npm install` in server folder |
| Website not loading | Make sure server is running |

---

## 💡 Pro Tips

- **Backup your data**: Copy the `server/data/` folder regularly
- **Test before use**: Always test with 1-2 students first
- **Keep it running**: Don't close the server terminal while using
- **Multiple cards**: Each card can only be registered once

---

## 🎯 Daily Workflow

1. Start computer
2. Connect Arduino
3. Open PowerShell → `cd server` → `npm start`
4. Open browser → `http://localhost:3000`
5. Click "Scanner"
6. Ready to scan! 📡

---

Need detailed instructions? See [README.md](README.md)
