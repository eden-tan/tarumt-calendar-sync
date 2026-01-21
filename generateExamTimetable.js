require('dotenv').config();
const fs = require('fs');
const { exec } = require('child_process');

const loginUrl = "https://app.tarc.edu.my/MobileService/login.jsp";
const timetableUrl = "https://app.tarc.edu.my/MobileService/services/AJAXExamTimetable.jsp?act=list&mversion=1";

const deviceId = "92542A7E-B31D-461F-8B1C-15215824E3F9";
const deviceModel = "MacBook Air M4 24GB RAM 512GB ROM";

const username = process.env.TARUMT_USERNAME;
const password = process.env.TARUMT_PASSWORD;

async function login() {
  const loginData = new URLSearchParams({
    username: username,
    password: password,
    deviceid: deviceId,
    devicemodel: deviceModel,
    appversion: "2.0.18"
  });

  const fetchOptions = {
    method: "POST",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Origin': 'ionic://localhost'
    },
    body: loginData.toString()
  };

  try {
    const response = await fetch(loginUrl, fetchOptions);
    const raw = await response.text();

    const jsonStart = raw.lastIndexOf("{");
    if (jsonStart === -1) throw new Error("Login response does not contain JSON");

    const jsonPart = raw.slice(jsonStart);
    const data = JSON.parse(jsonPart);

    if (data.msg === "success" && data.token) {
      console.log("Login successful");
      return data.token;
    } else {
      throw new Error("Login failed: " + (data.msgdesc || "Unknown error"));
    }
  } catch (error) {
    console.error("Login error:", error.message);
    return null;
  }
}

async function getTimetable(token) {
  const fetchOptions = {
    method: "POST",
    headers: {
      'X-Auth': token,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'Origin': 'ionic://localhost'
    }
  };

  try {
    const response = await fetch(timetableUrl, fetchOptions);
    const raw = await response.text();

    const match = raw.match(/{[\s\S]*}/);
    if (!match) throw new Error("Timetable response does not contain valid JSON");

    return JSON.parse(match[0]);
  } catch (error) {
    console.error("Get timetable error:", error.message);
    return null;
  }
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

// ✅ 防止 Apple Calendar 因特殊字符导致字段不显示
function icsEscape(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

async function generateExamICS(timetable) {
  if (!timetable || !timetable.rec || timetable.rec.length === 0) {
    console.log("No exam timetable data available yet. Exams may not be scheduled.");
    return;
  }

  const events = [];

  for (const exam of timetable.rec) {
    // ✅ 年份/月/日完全跟着 API
    const yyyy = parseInt(exam.fexyear, 10);

    // fexmonth 可能是 "Jan" 这种字符串
    const monthIndex = new Date(`${exam.fexmonth} 1`).getMonth(); // 0-11
    const ddNum = parseInt(exam.fexday, 10);

    // 解析开始时间
    const [hhStr, mmStr] = convertTo24Hour(exam.ftime).split(':');
    const startHour = parseInt(hhStr, 10);
    const startMin = parseInt(mmStr, 10);

    // ✅ 用 Date 计算 DTEND，自动处理跨日，避免 24/25 点非法时间
    const startDate = new Date(yyyy, monthIndex, ddNum, startHour, startMin, 0);
    const durationHours = parseInt(exam.fhour, 10) || 0;
    const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

    const start = formatICSDate(startDate);
    const end = formatICSDate(endDate);

    // location 可能来自 summary 的第二段
    const locationRaw = (exam.fsummary && exam.fsummary.split(',')[1]?.trim()) || "TARUMT";

    const summary = `📝 EXAM: ${exam.fdesc}`;
    const description = `Subject Code: ${exam.funits}\nType: ${exam.fpaptype}\nSeat Range: 1–${exam.ftosit}`;

    const event = [
      "BEGIN:VEVENT",
      `UID:exam-${exam.funits}-${start}@exam.local`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART;TZID=Asia/Kuala_Lumpur:${start}`,
      `DTEND;TZID=Asia/Kuala_Lumpur:${end}`,
      `SUMMARY:${icsEscape(summary)}`,
      `LOCATION:${icsEscape(locationRaw)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      "END:VEVENT"
    ].join("\n");

    events.push(event);
  }

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TARUMT//Exam Timetable Generator//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR"
  ].join("\n");

  fs.writeFileSync("exam_timetable.ics", icsContent);
  console.log(`✅ ICS file generated: exam_timetable.ics (${events.length} exam event(s))`);
}

async function main() {
  try {
    if (!username || !password) {
      console.error("ERROR: Missing credentials. Please set TARUMT_USERNAME and TARUMT_PASSWORD environment variables.");
      process.exit(0);
    }

    const token = await login();
    if (!token) {
      console.error("Login failed. Please check your credentials.");
      process.exit(0);
    }

    const timetable = await getTimetable(token);
    if (timetable) {
      await generateExamICS(timetable);

      // Only open on macOS when running locally (not in GitHub Actions)
      if (process.platform === 'darwin' && !process.env.GITHUB_ACTIONS) {
        exec('open exam_timetable.ics');
      }
    }

    console.log("Exam timetable processing completed successfully");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(0);
  }
}

main();
