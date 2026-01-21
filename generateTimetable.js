require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const logStream = fs.createWriteStream('timetable.log', { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  logStream.write(`[${timestamp}] ${message}\n`);
}

// for execute at macos
const { exec } = require('child_process');

const loginUrl = "https://app.tarc.edu.my/MobileService/studentLogin.jsp";
const classTimetableUrl = "https://app.tarc.edu.my/MobileService/services/AJAXStudentTimetable.jsp?act=get&week=all";
const examTimetableUrl = "https://app.tarc.edu.my/MobileService/services/AJAXExamTimetable.jsp?act=list&mversion=1";

const deviceId = "92542A7E-B31D-461F-8B1C-15215824E3F9";
const deviceModel = "MacBook Air M4 24GB RAM 512GB ROM";

const username = process.env.TARUMT_USERNAME;
const password = process.env.TARUMT_PASSWORD;
// APP_SECRET is set in GitHub Actions workflow, fallback for local development
const APP_SECRET = process.env.APP_SECRET || "3f8a7c12d9e54b88b6a2f4d915c3e7a1";

/**
 * Create HMAC-SHA-256 signature
 * @param {string} data - The data to sign (params + timestamp)
 * @param {string} secret - The secret key
 * @returns {string} Base64 encoded signature
 */
function createSignature(data, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  return hmac.digest('base64');
}

async function login() {
  const timestamp = Math.floor(Date.now() / 1000);

  const params = {
    username: username,
    password: password,
    deviceid: deviceId,
    devicemodel: deviceModel,
    appversion: "2.0.19",
    fplatform: "ios"
  };

  const paramsString = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const signatureData = paramsString + '|' + timestamp;
  const signature = createSignature(signatureData, APP_SECRET);

  const loginData = new URLSearchParams(params);

  const fetchOptions = {
    method: "POST",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.39 Mobile Safari/537.36',
      'Origin': 'ionic://localhost',
      'Referer': 'https://localhost/',
      'X-Signature': signature,
      'X-Timestamp': timestamp.toString()
    },
    body: loginData.toString()
  };

  try {
    const response = await fetch(loginUrl, fetchOptions);
    const raw = await response.text();

    const jsonStart = raw.lastIndexOf("{");
    if (jsonStart === -1) {
      throw new Error("Login response does not contain JSON");
    }
    const jsonPart = raw.slice(jsonStart);
    const data = JSON.parse(jsonPart);

    if (data.msg === "success" && data.token) {
      log("Login successful");
      return data.token;
    } else {
      throw new Error("Login failed: " + (data.msgdesc || "Unknown error"));
    }
  } catch (error) {
    log("Login error: " + error.message);
    return null;
  }
}

async function getClassTimetable(token) {
  const timestamp = Math.floor(Date.now() / 1000);

  const params = { act: 'get', week: 'all' };
  const paramsString = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const signatureData = paramsString + '|' + timestamp;
  const signature = createSignature(signatureData, APP_SECRET);

  const fetchOptions = {
    method: "POST",
    headers: {
      'X-Auth': token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.39 Mobile Safari/537.36',
      'Origin': 'ionic://localhost',
      'X-Signature': signature,
      'X-Timestamp': timestamp.toString()
    }
  };

  try {
    const response = await fetch(classTimetableUrl, fetchOptions);
    const raw = await response.text();
    const match = raw.match(/{[\s\S]*}/);
    if (!match) throw new Error("Class timetable response does not contain valid JSON");
    return JSON.parse(match[0]);
  } catch (error) {
    log("Get class timetable error: " + error.message);
    return null;
  }
}

async function getExamTimetable(token) {
  const timestamp = Math.floor(Date.now() / 1000);

  const params = { act: 'list', mversion: '1' };
  const paramsString = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const signatureData = paramsString + '|' + timestamp;
  const signature = createSignature(signatureData, APP_SECRET);

  const fetchOptions = {
    method: "POST",
    headers: {
      'X-Auth': token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/134.0.6998.39 Mobile Safari/537.36',
      'Origin': 'ionic://localhost',
      'X-Signature': signature,
      'X-Timestamp': timestamp.toString()
    }
  };

  try {
    const response = await fetch(examTimetableUrl, fetchOptions);
    const raw = await response.text();
    const match = raw.match(/{[\s\S]*}/);
    if (!match) throw new Error("Exam timetable response does not contain valid JSON");
    return JSON.parse(match[0]);
  } catch (error) {
    log("Get exam timetable error: " + error.message);
    return null;
  }
}

// Helper to parse week string, e.g. "all", "1-3,5,7-9"
function parseWeeks(weekStr, allWeeks) {
  if (weekStr === "all") return allWeeks.filter(w => w !== "all").map(Number);
  return weekStr.split(',').flatMap(part => {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    } else {
      return [Number(part)];
    }
  });
}

function formatICSDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = "00";
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
}

function convertTo24Hour(timeStr) {
  const [time, modifier] = timeStr.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (modifier === "PM" && hours !== 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

/**
 * ✅ FIXED: Do NOT hardcode year.
 * - Try parse year from duration string first.
 * - If missing year, infer based on "semester start month" and current month.
 *
 * Examples supported:
 *  - "26 Jan"
 *  - "26 Jan 2026"
 *  - "26 Jan - 10 May 2026"
 *  - "26 Jan 2026 - 10 May 2026"
 */
function extractSemesterStart(durationStr) {
  if (!durationStr || durationStr.trim() === "") {
    throw new Error("Duration string is empty - no timetable data available");
  }

  const match = durationStr.match(/^(\d{1,2})\s([A-Za-z]{3})(?:\s(\d{4}))?/);
  if (!match) {
    throw new Error(`Unable to parse semester start date from: "${durationStr}"`);
  }

  const day = parseInt(match[1], 10);
  const month = match[2];
  const yearInStr = match[3] ? parseInt(match[3], 10) : null;

  const monthMap = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };

  if (!(month in monthMap)) {
    throw new Error(`Unknown month "${month}" in duration: "${durationStr}"`);
  }

  let year;
  if (yearInStr) {
    year = yearInStr;
  } else {
    const now = new Date();
    const startMonth = monthMap[month];
    year = now.getFullYear();

    // If semester starts in Jan-Jun and now is Aug-Dec, it's likely next year
    if (startMonth <= 5 && now.getMonth() >= 7) {
      year += 1;
    }
  }

  // ✅ IMPORTANT: set to 12:00 to avoid timezone/UTC shifting the date
  return new Date(year, monthMap[month], day, 12, 0, 0);
}

async function generateICS(classTimetable, examTimetable) {
  const events = [];

  // Process class timetable
  if (classTimetable && classTimetable.duration && classTimetable.duration.trim() !== "" && classTimetable.rec && classTimetable.rec.length > 0) {
    log("Processing class timetable data...");
    const semesterStart = extractSemesterStart(classTimetable.duration);

    for (const day of classTimetable.rec) {
      const dow = parseInt(day.dow, 10); // 1=Mon, ..., 7=Sun
      if (!day.class) continue;

      for (const cls of day.class) {
        const weekList = parseWeeks(cls.fweedur || "all", classTimetable.weeks);

        for (const week of weekList) {
          const baseDate = new Date(semesterStart);

          // ✅ FIX: use (dow - 1) so Monday aligns correctly
          baseDate.setDate(baseDate.getDate() + (week - 1) * 7 + (dow - 1));

          // ✅ FIX: do NOT use toISOString() to derive date (UTC shift causes -1 day)
          const y = baseDate.getFullYear();
          const m = String(baseDate.getMonth() + 1).padStart(2, '0');
          const d = String(baseDate.getDate()).padStart(2, '0');
          const baseDateStr = `${y}-${m}-${d}`;

          const startDateTime = new Date(`${baseDateStr}T${convertTo24Hour(cls.fstart)}`);
          const endDateTime = new Date(`${baseDateStr}T${convertTo24Hour(cls.fend)}`);

          const event = [
            "BEGIN:VEVENT",
            `UID:class-${cls.funits}-W${week}-${day.dow}-${cls.fstart}@timetable.local`,
            `DTSTAMP:${formatICSDate(new Date())}`,
            `DTSTART;TZID=Asia/Kuala_Lumpur:${formatICSDate(startDateTime)}`,
            `DTEND;TZID=Asia/Kuala_Lumpur:${formatICSDate(endDateTime)}`,
            `SUMMARY:(${cls.fclasstype}) ${cls.fdesc}`,
            `LOCATION:${(cls.froom || "").trim()}`,
            `DESCRIPTION:Lecturer: ${cls.fstaffname}\\nSubject Code: ${cls.funits}`,
            "END:VEVENT"
          ].join("\n");

          events.push(event);
        }
      }
    }

    log(`Added ${events.length} class events`);
  } else {
    log("No class timetable data available yet. Skipping class schedule.");
    console.log("No class timetable data available yet. The semester may not have started or no classes are scheduled.");
  }

  // Process exam timetable
  if (examTimetable && examTimetable.rec && examTimetable.rec.length > 0) {
    log("Processing exam timetable data...");
    const examEventsCount = examTimetable.rec.length;

    for (const exam of examTimetable.rec) {
      const yyyy = exam.fexyear;
      const mm = String(new Date(`${exam.fexmonth} 1`).getMonth() + 1).padStart(2, '0');
      const dd = String(exam.fexday).padStart(2, '0');

      const [hour, minute] = convertTo24Hour(exam.ftime).split(':');
      const start = `${yyyy}${mm}${dd}T${hour}${minute}00`;

      const endHour = parseInt(hour, 10) + parseInt(exam.fhour, 10);
      const end = `${yyyy}${mm}${dd}T${String(endHour).padStart(2, '0')}${minute}00`;

      const location = (exam.fsummary && exam.fsummary.split(',')[1]?.trim()) || "TARUMT";

      const event = [
        "BEGIN:VEVENT",
        `UID:exam-${exam.funits}-${start}@timetable.local`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART;TZID=Asia/Kuala_Lumpur:${start}`,
        `DTEND;TZID=Asia/Kuala_Lumpur:${end}`,
        `SUMMARY:📝 EXAM: ${exam.fdesc}`,
        `LOCATION:${location}`,
        `DESCRIPTION:Subject Code: ${exam.funits}\\nType: ${exam.fpaptype}\\nSeat Range: 1–${exam.ftosit}`,
        "END:VEVENT"
      ].join("\n");

      events.push(event);
    }

    log(`Added ${examEventsCount} exam events`);
    console.log(`Added ${examEventsCount} exam(s) to timetable`);
  } else {
    log("No exam timetable data available yet. Skipping exam schedule.");
    console.log("No exam timetable data available yet. Exams may not be scheduled.");
  }

  if (events.length > 0) {
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TARUMT//Timetable Generator//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR"
    ].join("\n");

    fs.writeFileSync("timetable.ics", icsContent);
    log(`ICS file generated: timetable.ics (${events.length} total events)`);
    console.log(`✅ Generated timetable.ics with ${events.length} event(s)`);
  } else {
    log("No events to generate. Skipping ICS file creation.");
    console.log("⚠️ No timetable or exam data available. No ICS file generated.");
  }
}

async function main() {
  try {
    if (!username || !password) {
      log("ERROR: Missing credentials. Please set TARUMT_USERNAME and TARUMT_PASSWORD environment variables.");
      console.error("ERROR: Missing credentials. Please set TARUMT_USERNAME and TARUMT_PASSWORD environment variables.");
      process.exit(0); // Exit gracefully to avoid failing GitHub Actions
    }

    const token = await login();
    if (token) {
      const classTimetable = await getClassTimetable(token);
      const examTimetable = await getExamTimetable(token);

      await generateICS(classTimetable, examTimetable);

      if (process.platform === 'darwin' && !process.env.GITHUB_ACTIONS) {
        exec('open timetable.ics');
      }

      log("Timetable processing completed successfully");
    } else {
      log("Login failed - unable to retrieve authentication token");
      console.error("Login failed. Please check your credentials.");
      process.exit(0);
    }
  } catch (error) {
    log(`ERROR in main: ${error.message}`);
    console.error(`ERROR: ${error.message}`);
    process.exit(0);
  }
}

main();

process.on('exit', () => {
  logStream.end();
});
