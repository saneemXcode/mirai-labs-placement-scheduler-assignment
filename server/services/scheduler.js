import Company from "../models/Company.js";
import Shortlist from "../models/Shortlist.js";
import Interview from "../models/Interview.js";
import Room from "../models/Room.js";
import ScheduleConfig from "../models/ScheduleConfig.js";

export const STUDENT_BUFFER = 10;
export const DAY_START = 540;
export const DAY_END = 1020;

const overlaps = (a, b, c, d) => a < d && c < b;
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const idOf = (value) => {
  if (value == null) return null;
  if (typeof value === "object" && value._id != null) return String(value._id);
  return String(value);
};
const companyDays = (c) =>
  [...(Array.isArray(c?.days) ? c.days : []), c?.day]
    .map(Number)
    .filter((d) => d >= 1 && d <= 4)
    .filter((d, i, a) => a.indexOf(d) === i)
    .sort((a, b) => a - b);

export async function buildSchedule(options = {}) {
  const { releasedSlots = [], minimumTargetCount = null, fillUnscheduled = false, priorityRoomId = null } = options;
  const previous = await Interview.find({ status: "scheduled" }).lean();
  await Interview.deleteMany({ status: "scheduled" });

  const [companies, rooms, shortlists, config] = await Promise.all([
    Company.find().sort({ priority: 1, name: 1 }).lean(),
    Room.find({ status: "available" }).sort({ name: 1 }).lean(),
    Shortlist.find().populate("studentId").populate("companyId").lean(),
    ScheduleConfig.findOne().sort({ createdAt: -1 }).lean(),
  ]);

  // Populate can occasionally return a null reference. Never dereference _id
  // until the reference has been normalized.
  const active = shortlists.filter((x) => {
    const student = x?.studentId;
    const company = x?.companyId;
    return idOf(student) && idOf(company) && student?.status === "Eligible";
  });

  if (!companies.length || !rooms.length || !active.length) {
    return { scheduled: [], unscheduled: active, targetCount: 0, targetPercent: config?.targetPercent };
  }

  // The configured target is generated in generator.js as >60% and <=70%.
  // Clamp it defensively so every successful Generate stays inside that range.

  // const rawTarget = Number(config?.targetPercent);
  // const targetPercent = Number.isFinite(rawTarget) ? Math.min(70, Math.max(60.1, rawTarget)) : 65;
  // const maxAllowed = Math.floor(active.length * 0.7);
  // const minRequired = Math.floor(active.length * 0.6) + 1;
  // const configuredTarget = Number(config?.targetInterviewCount);
  // let targetCount = Number.isFinite(configuredTarget) && configuredTarget > 0
  //   ? Math.round(configuredTarget)
  //   : Math.ceil(active.length * targetPercent / 100);
  // targetCount = Math.max(minRequired, Math.min(maxAllowed, targetCount));


const rawTarget = Number(config?.targetPercent);
  const targetPercent = Number.isFinite(rawTarget) ? Math.min(80, Math.max(70.1, rawTarget)) : 75;
  const maxAllowed = Math.floor(active.length * 0.8);
  const minRequired = Math.floor(active.length * 0.7) + 1;
  const configuredTarget = Number(config?.targetInterviewCount);
  let targetCount = Number.isFinite(configuredTarget) && configuredTarget > 0
    ? Math.round(configuredTarget)
    : Math.ceil(active.length * targetPercent / 100);
  targetCount = Math.max(minRequired, Math.min(maxAllowed, targetCount));





  // During a student withdrawal, released interviews should be treated as
  // immediately reusable appointments. If enough eligible unscheduled students
  // exist, we keep the schedule from shrinking simply because one student left.
  // The normal Generate/Reset flow does not pass this option.
  if (Number.isFinite(Number(minimumTargetCount)) && Number(minimumTargetCount) > 0) {
    targetCount = Math.max(targetCount, Math.min(maxAllowed, Math.round(Number(minimumTargetCount))));
  }

  // A room returning to service creates real scheduling capacity. For this
  // recovery pass we deliberately consume the unscheduled queue instead of
  // stopping at the normal Generate target. This allows the newly available
  // room to receive new candidates rather than remaining empty.
  if (fillUnscheduled) {
    targetCount = active.length;
  }

  const companyMap = new Map(companies.map((c) => [idOf(c), c]));
  const maxRoomStreams = (r) => Math.min(4, Math.max(1, Number(r?.maxPanels) || 4));
  const maxRoomCandidates = (r) => Math.max(1, Math.min(100, Number(r?.maxCandidatesPerDay ?? r?.capacity) || 100));

  const roomState = new Map();
  for (const room of rooms) {
    for (let day = 1; day <= 4; day++) {
      roomState.set(`${day}-${idOf(room)}`, { candidates: 0, streams: new Map() });
    }
  }

  const panelState = new Map();
  const studentState = new Map();
  const scheduled = [];
  const scheduledPairs = new Set();
  const scheduledStudents = new Set();
  const replacementAssignments = [];

  const getPanel = (companyId, panel, day) => panelState.get(`${day}-${companyId}-${panel}`) || [];
  const getStudent = (studentId, day) => studentState.get(`${studentId}-${day}`) || [];
  const studentFree = (studentId, day, start, end) =>
    !getStudent(studentId, day).some((x) => overlaps(start - STUDENT_BUFFER, end + STUDENT_BUFFER, x.start, x.end));
  const panelFree = (companyId, panel, day, start, end) =>
    !getPanel(companyId, panel, day).some((x) => overlaps(start, end, x.start, x.end));

  const activeStreamCount = (state, start, end, stream) => {
    let count = 0;
    for (const [key, intervals] of state.streams) {
      if (key === stream) continue;
      if (intervals.some((x) => overlaps(start, end, x.start, x.end))) count++;
    }
    return count;
  };

  const roomCanHost = (room, day, start, end, companyId, panel) => {
    const state = roomState.get(`${day}-${idOf(room)}`);
    if (!state || state.candidates >= maxRoomCandidates(room)) return false;
    const stream = `${companyId}-${panel}`;
    const current = state.streams.get(stream) || [];
    if (current.length) return true;
    // A room may host at most 4 distinct company/panel streams during a day.
    // A stream that is already assigned to the room can continue for the day.
    return state.streams.size < maxRoomStreams(room);
  };

  const panelRoom = new Map();
  const pickRoom = (companyId, panel, day, start, end) => {
    const key = `${day}-${companyId}-${panel}`;
    const preferred = panelRoom.get(key);
    if (preferred && roomCanHost(preferred, day, start, end, companyId, panel)) return preferred;

    const candidates = shuffled(rooms).sort((a, b) => {
      const sa = roomState.get(`${day}-${idOf(a)}`);
      const sb = roomState.get(`${day}-${idOf(b)}`);
      return (sa?.candidates || 0) - (sb?.candidates || 0) || (sa?.streams?.size || 0) - (sb?.streams?.size || 0);
    });

    // On room recovery, prefer the newly returned room for a NEW panel stream.
    // This prevents the room from showing Available but remaining unused while
    // other rooms continue absorbing all newly scheduled interviews.
    if (priorityRoomId && !panelRoom.has(key)) {
      const recoveryRoom = rooms.find((r) => idOf(r) === String(priorityRoomId));
      if (recoveryRoom && roomCanHost(recoveryRoom, day, start, end, companyId, panel)) {
        panelRoom.set(key, recoveryRoom);
        return recoveryRoom;
      }
    }

    const room = candidates.find((r) => roomCanHost(r, day, start, end, companyId, panel));
    if (room) panelRoom.set(key, room);
    return room || null;
  };

  const book = (shortlist, company, room, day, panel, start) => {
    const student = shortlist.studentId;
    const studentId = idOf(student);
    const companyId = idOf(company);
    const roomId = idOf(room);
    const duration = Number(company.duration) || 30;
    const end = start + duration;
    const item = {
      studentId,
      companyId,
      roomId,
      day,
      startMinute: start,
      endMinute: end,
      panel,
      status: "scheduled",
    };
    scheduled.push(item);
    scheduledPairs.add(`${studentId}-${companyId}`);
    scheduledStudents.add(studentId);

    const sk = `${studentId}-${day}`;
    const sa = studentState.get(sk) || [];
    sa.push({ start, end });
    studentState.set(sk, sa);

    const pk = `${day}-${companyId}-${panel}`;
    const pa = panelState.get(pk) || [];
    pa.push({ start, end });
    panelState.set(pk, pa);

    const rk = `${day}-${roomId}`;
    const rs = roomState.get(rk);
    if (rs) {
      rs.candidates++;
      const stream = `${companyId}-${panel}`;
      const streamArr = rs.streams.get(stream) || [];
      streamArr.push({ start, end });
      rs.streams.set(stream, streamArr);
    }
    return item;
  };

  const byStudent = new Map();
  const byCompany = new Map();
  for (const x of active) {
    const sid = idOf(x.studentId);
    const cid = idOf(x.companyId);
    if (!sid || !cid) continue;
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    if (!byCompany.has(cid)) byCompany.set(cid, []);
    byStudent.get(sid).push(x);
    byCompany.get(cid).push(x);
  }

  // Preserve existing assignments when they are still feasible. This keeps
  // disruption replans stable while allowing newly freed capacity to be used.
  for (const old of shuffled(previous)) {
    if (scheduled.length >= targetCount) break;
    const sid = idOf(old.studentId);
    const cid = idOf(old.companyId);
    if (!sid || !cid || scheduledPairs.has(`${sid}-${cid}`)) continue;
    const shortlist = byStudent.get(sid)?.find((x) => idOf(x.companyId) === cid);
    const company = companyMap.get(cid);
    const day = Number(old.day);
    const panel = Number(old.panel);
    const room = rooms.find((r) => idOf(r) === idOf(old.roomId));
    const start = Number(old.startMinute);
    const duration = Number(company?.duration) || 30;
    const end = start + duration;
    if (!shortlist || !company || !room || !companyDays(company).includes(day)) continue;
    if (start < DAY_START || end > DAY_END) continue;
    if (panel < 1 || panel > Math.min(8, Number(company.panels) || 1)) continue;
    if ((company.blockedPanels || []).includes(panel)) continue;
    if (!studentFree(sid, day, start, end) || !panelFree(cid, panel, day, start, end)) continue;
    if (!roomCanHost(room, day, start, end, cid, panel)) continue;
    panelRoom.set(`${day}-${cid}-${panel}`, room);
    book(shortlist, company, room, day, panel, start);
  }

  // FIRST: reuse appointments released by a withdrawal. Each released slot
  // keeps its original company, room, panel, day and exact time. We look for an
  // eligible shortlisted student who was not already scheduled for that company.
  // This is the key replacement behavior: if Student E leaves Company D at a
  // particular appointment, that exact D appointment can be given to Student F
  // when F has D shortlisted but unscheduled.
  const released = shuffled(
    (Array.isArray(releasedSlots) ? releasedSlots : [])
      .map(x => ({
        studentId: idOf(x.studentId),
        companyId: idOf(x.companyId),
        roomId: idOf(x.roomId),
        day: Number(x.day),
        panel: Number(x.panel),
        start: Number(x.startMinute),
        end: Number(x.endMinute),
      }))
      .filter(x => x.companyId && x.roomId && x.day >= 1 && x.day <= 4 &&
        Number.isFinite(x.start) && Number.isFinite(x.end) && x.start >= DAY_START && x.end <= DAY_END &&
        x.panel >= 1)
  );

  for (const slot of released) {
    const company = companyMap.get(slot.companyId);
    const room = rooms.find(r => idOf(r) === slot.roomId);
    if (!company || !room || !companyDays(company).includes(slot.day)) continue;
    if (slot.panel > Math.min(8, Number(company.panels) || 1)) continue;
    if ((company.blockedPanels || []).includes(slot.panel)) continue;

    const candidates = shuffled(byCompany.get(slot.companyId) || [])
      .filter(x => {
        const sid = idOf(x.studentId);
        return sid &&
          !scheduledPairs.has(`${sid}-${slot.companyId}`) &&
          studentFree(sid, slot.day, slot.start, slot.end);
      });

    // Prefer a student who currently has this company unscheduled and fewer
    // total interviews, while retaining randomness between equally suitable candidates.
    candidates.sort((a, b) => {
      const ac = [1, 2, 3, 4].reduce((n, d) => n + (studentState.get(`${idOf(a.studentId)}-${d}`)?.length || 0), 0);
      const bc = [1, 2, 3, 4].reduce((n, d) => n + (studentState.get(`${idOf(b.studentId)}-${d}`)?.length || 0), 0);
      return ac - bc || Math.random() - 0.5;
    });

    // const shortlist = candidates[0];
    // if (!shortlist) continue;
    // if (!panelFree(slot.companyId, slot.panel, slot.day, slot.start, slot.end)) continue;
    // if (!roomCanHost(room, slot.day, slot.start, slot.end, slot.companyId, slot.panel)) continue;

    // panelRoom.set(`${slot.day}-${slot.companyId}-${slot.panel}`, room);
    // book(shortlist, company, room, slot.day, slot.panel, slot.start);

    const shortlist = candidates[0];

if (!shortlist) continue;

if (
  !panelFree(
    slot.companyId,
    slot.panel,
    slot.day,
    slot.start,
    slot.end
  )
) continue;

if (
  !roomCanHost(
    room,
    slot.day,
    slot.start,
    slot.end,
    slot.companyId,
    slot.panel
  )
) continue;

panelRoom.set(
  `${slot.day}-${slot.companyId}-${slot.panel}`,
  room
);

const replacement = book(
  shortlist,
  company,
  room,
  slot.day,
  slot.panel,
  slot.start
);

replacementAssignments.push({
  studentId: replacement.studentId,
  companyId: replacement.companyId,
  roomId: replacement.roomId,
  day: replacement.day,
  startMinute: replacement.startMinute,
  endMinute: replacement.endMinute,
  panel: replacement.panel,
  replacedStudentId: slot.studentId
});
  }

  // Build every real interview slot from 09:00 through 17:00. The next slot
  // starts immediately after the previous interview; there are no artificial gaps.
  const slots = [];
  for (const company of companies) {
    const cid = idOf(company);
    const duration = Math.max(15, Number(company.duration) || 30);
    const panels = Array.from({ length: Math.min(8, Number(company.panels) || 1) }, (_, i) => i + 1)
      .filter((p) => !(company.blockedPanels || []).includes(p));
    for (const day of companyDays(company)) {
      for (const panel of panels) {
        for (let start = DAY_START; start + duration <= DAY_END; start += duration) {
          slots.push({ company, companyId: cid, day, panel, start, end: start + duration });
        }
      }
    }
  }

  // Process all four days. Day 1 intentionally favors mass recruiters, while
  // Days 2-4 are distributed randomly. The target is NOT split equally across
  // the four days; this prevents the dashboard from showing artificial 25%/25%
  // day counts while still ensuring every day gets interview activity.
  const massRecruiterNames = new Set(
    companies
      .filter((c) => c?.massRecruiter === true || ["Amazon", "Tata Consultancy Services"].includes(c?.name))
      .map((c) => c.name)
  );

  const dayWeights = (() => {
    const day1 = 0.38 + Math.random() * 0.14; // 38%-52% on Day 1
    const rest = 1 - day1;
    const r2 = 0.20 + Math.random() * 0.45;
    const r3 = 0.20 + Math.random() * 0.45;
    const r4 = 1 - r2 - r3;
    const raw = [day1, rest * r2, rest * r3, rest * r4];
    const safe = raw.map((x) => Math.max(0.05, x));
    const total = safe.reduce((a, b) => a + b, 0);
    return safe.map((x) => x / total);
  })();
  const dayTarget = new Map([1, 2, 3, 4].map((d, i) => [
    d, Math.max(1, Math.floor(targetCount * dayWeights[i]))
  ]));
  // Adjust rounding so the four day targets sum exactly to targetCount.
  let quotaTotal = [...dayTarget.values()].reduce((a, b) => a + b, 0);
  let quotaDay = 1;
  while (quotaTotal < targetCount) {
    dayTarget.set(quotaDay, dayTarget.get(quotaDay) + 1);
    quotaTotal++;
    quotaDay = quotaDay === 4 ? 1 : quotaDay + 1;
  }
  const dayCounts = new Map([1, 2, 3, 4].map((d) => [d, 0]));

  // Day 1 mass-recruiter slots come first. The remaining slots are randomized
  // so Days 2-4 do not follow a fixed or equal pattern.
  slots.sort((a, b) => {
    const am = a.day === 1 && massRecruiterNames.has(a.company?.name) ? 0 : 1;
    const bm = b.day === 1 && massRecruiterNames.has(b.company?.name) ? 0 : 1;
    if (am !== bm) return am - bm;
    return Math.random() - 0.5;
  });

  // Pass 1: give every student one interview before spending capacity on extras.
  // Students with fewer/no interviews are preferred, while company choices stay random.
  const needsCoverage = new Set(shuffled([...byStudent.keys()]).filter((sid) => !scheduledStudents.has(sid)));

  for (const slot of slots) {
    if (!needsCoverage.size) break;
    if ((dayCounts.get(slot.day) || 0) >= (dayTarget.get(slot.day) || 1)) continue;
    const choices = shuffled(byCompany.get(slot.companyId) || [])
      .filter((x) => needsCoverage.has(idOf(x.studentId)) && !scheduledPairs.has(`${idOf(x.studentId)}-${slot.companyId}`));
    const shortlist = choices.find((x) => {
      const sid = idOf(x.studentId);
      return studentFree(sid, slot.day, slot.start, slot.end);
    });
    if (!shortlist) continue;
    const room = pickRoom(slot.companyId, slot.panel, slot.day, slot.start, slot.end);
    if (!room || !panelFree(slot.companyId, slot.panel, slot.day, slot.start, slot.end)) continue;
    if (!roomCanHost(room, slot.day, slot.start, slot.end, slot.companyId, slot.panel)) continue;
    book(shortlist, slot.company, room, slot.day, slot.panel, slot.start);
    dayCounts.set(slot.day, (dayCounts.get(slot.day) || 0) + 1);
    needsCoverage.delete(idOf(shortlist.studentId));
  }

  // Pass 2: fill additional shortlisted-company interviews until the configured
  // target is reached. During room recovery, fillUnscheduled=true raises the
  // target to the full active queue so newly available capacity is consumed.
  for (const slot of slots) {
    if (scheduled.length >= targetCount) break;
    const underTargetDay = [1,2,3,4].some((d) => (dayCounts.get(d) || 0) < (dayTarget.get(d) || 1));
    if (underTargetDay && (dayCounts.get(slot.day) || 0) >= (dayTarget.get(slot.day) || 1)) continue;
    const choices = shuffled(byCompany.get(slot.companyId) || [])
      .filter((x) => !scheduledPairs.has(`${idOf(x.studentId)}-${slot.companyId}`));
    if (!choices.length) continue;

    choices.sort((a, b) => {
      const ac = [1, 2, 3, 4].reduce((n, d) => n + (studentState.get(`${idOf(a.studentId)}-${d}`)?.length || 0), 0);
      const bc = [1, 2, 3, 4].reduce((n, d) => n + (studentState.get(`${idOf(b.studentId)}-${d}`)?.length || 0), 0);
      return ac - bc || Math.random() - 0.5;
    });

    const shortlist = choices.find((x) => studentFree(idOf(x.studentId), slot.day, slot.start, slot.end));
    if (!shortlist) continue;
    const room = pickRoom(slot.companyId, slot.panel, slot.day, slot.start, slot.end);
    if (!room || !panelFree(slot.companyId, slot.panel, slot.day, slot.start, slot.end)) continue;
    if (!roomCanHost(room, slot.day, slot.start, slot.end, slot.companyId, slot.panel)) continue;
    book(shortlist, slot.company, room, slot.day, slot.panel, slot.start);
    dayCounts.set(slot.day, (dayCounts.get(slot.day) || 0) + 1);
  }

  const scheduledKeys = new Set(scheduled.map((x) => `${idOf(x.studentId)}-${idOf(x.companyId)}`));
  const unscheduled = active
    .filter((x) => !scheduledKeys.has(`${idOf(x.studentId)}-${idOf(x.companyId)}`))
    .map((x) => ({
      studentId: idOf(x.studentId),
      companyId: idOf(x.companyId),
      reason: "The interview remains in the scheduling queue because a suitable panel, room, student time window, and interview capacity are not currently available.",
    }));

  if (scheduled.length) await Interview.insertMany(scheduled, { ordered: true });

  // return { scheduled, unscheduled, targetCount, targetPercent };
  return {
  scheduled,
  unscheduled,
  targetCount,
  targetPercent,
  replacementAssignments
};
}


function makeOccupancy(rows, rooms) {
  const studentState = new Map();
  const panelState = new Map();
  const roomState = new Map();

  const push = (map, key, value) => {
    const arr = map.get(key) || [];
    arr.push(value);
    map.set(key, arr);
  };

  for (const room of rooms) {
    for (let day = 1; day <= 4; day++) {
      roomState.set(`${day}-${idOf(room)}`, { candidates: 0, streams: new Map() });
    }
  }

  for (const x of rows) {
    const start = Number(x.startMinute);
    const end = Number(x.endMinute);
    const sid = idOf(x.studentId);
    const cid = idOf(x.companyId);
    const rid = idOf(x.roomId);
    if (!sid || !cid || !rid) continue;
    push(studentState, `${sid}-${x.day}`, { start, end });
    push(panelState, `${x.day}-${cid}-${x.panel}`, { start, end });

    const rs = roomState.get(`${x.day}-${rid}`);
    if (rs) {
      rs.candidates++;
      const stream = `${cid}-${x.panel}`;
      const arr = rs.streams.get(stream) || [];
      arr.push({ start, end });
      rs.streams.set(stream, arr);
    }
  }

  return { studentState, panelState, roomState };
}

function roomCanHostState(room, roomState, day, start, end, companyId, panel) {
  const state = roomState.get(`${day}-${idOf(room)}`);
  if (!state) return false;
  const maxCandidates = Math.max(1, Math.min(100, Number(room?.maxCandidatesPerDay ?? room?.capacity) || 100));
  const maxStreams = Math.min(4, Math.max(1, Number(room?.maxPanels) || 4));
  if (state.candidates >= maxCandidates) return false;
  const stream = `${companyId}-${panel}`;
  if (state.streams.has(stream)) return true;
  return state.streams.size < maxStreams;
}

function studentFreeState(studentState, studentId, day, start, end) {
  const rows = studentState.get(`${studentId}-${day}`) || [];
  return !rows.some(x => overlaps(start - STUDENT_BUFFER, end + STUDENT_BUFFER, x.start, x.end));
}

function panelFreeState(panelState, companyId, panel, day, start, end) {
  const rows = panelState.get(`${day}-${companyId}-${panel}`) || [];
  return !rows.some(x => overlaps(start, end, x.start, x.end));
}

function addOccupancy(occ, item) {
  pushTo(occ.studentState, `${idOf(item.studentId)}-${item.day}`, { start: item.startMinute, end: item.endMinute });
  pushTo(occ.panelState, `${item.day}-${idOf(item.companyId)}-${item.panel}`, { start: item.startMinute, end: item.endMinute });
  const rs = occ.roomState.get(`${item.day}-${idOf(item.roomId)}`);
  if (rs) {
    rs.candidates++;
    const stream = `${idOf(item.companyId)}-${item.panel}`;
    const arr = rs.streams.get(stream) || [];
    arr.push({ start: item.startMinute, end: item.endMinute });
    rs.streams.set(stream, arr);
  }
}

function pushTo(map, key, value) {
  const arr = map.get(key) || [];
  arr.push(value);
  map.set(key, arr);
}

async function roomTargetedReplan({ roomId = null, affected = [], recovery = false } = {}) {
  const [scheduledRows, companies, rooms, shortlists] = await Promise.all([
    Interview.find({ status: "scheduled" }).lean(),
    Company.find().lean(),
    Room.find({ status: "available" }).sort({ name: 1 }).lean(),
    Shortlist.find().populate("studentId").populate("companyId").lean(),
  ]);

  const companyMap = new Map(companies.map(c => [idOf(c), c]));
  const activeShortlists = shortlists.filter(x => x?.studentId?.status === "Eligible" && idOf(x.studentId) && idOf(x.companyId));
  const occ = makeOccupancy(scheduledRows, rooms);
  const scheduledPairs = new Set(scheduledRows.map(x => `${idOf(x.studentId)}-${idOf(x.companyId)}`));
  const additions = [];

  const tryBook = (sl, company, room, day, panel, start) => {
    const duration = Number(company.duration) || 30;
    const end = start + duration;
    const sid = idOf(sl.studentId);
    const cid = idOf(company);
    if (start < DAY_START || end > DAY_END) return false;
    if (!companyDays(company).includes(day)) return false;
    if (panel < 1 || panel > Math.min(8, Number(company.panels) || 1)) return false;
    if ((company.blockedPanels || []).includes(panel)) return false;
    if (!studentFreeState(occ.studentState, sid, day, start, end)) return false;
    if (!panelFreeState(occ.panelState, cid, panel, day, start, end)) return false;
    if (!roomCanHostState(room, occ.roomState, day, start, end, cid, panel)) return false;

    const item = { studentId: sid, companyId: cid, roomId: idOf(room), day, startMinute: start, endMinute: end, panel, status: "scheduled" };
    additions.push(item);
    scheduledPairs.add(`${sid}-${cid}`);
    addOccupancy(occ, item);
    return true;
  };

  // Room unavailable: only the interviews that were actually in that room are
  // reconsidered. Existing unaffected appointments are never deleted/rebuilt.
  if (affected.length) {
    for (const old of shuffled(affected)) {
      const sid = idOf(old.studentId);
      const cid = idOf(old.companyId);
      const company = companyMap.get(cid);
      if (!sid || !cid || !company) continue;
      const sl = activeShortlists.find(x => idOf(x.studentId) === sid && idOf(x.companyId) === cid);
      if (!sl || scheduledPairs.has(`${sid}-${cid}`)) continue;

      const availableRooms = rooms.filter(r => !roomId || idOf(r) !== String(roomId));
      let placed = false;
      const exactFirst = [];
      const rest = [];
      for (const room of availableRooms) {
        exactFirst.push({ room, day: Number(old.day), panel: Number(old.panel), start: Number(old.startMinute) });
      }
      for (const day of companyDays(company)) {
        for (let panel = 1; panel <= Math.min(8, Number(company.panels) || 1); panel++) {
          if ((company.blockedPanels || []).includes(panel)) continue;
          for (let start = DAY_START; start + (Number(company.duration) || 30) <= DAY_END; start += Number(company.duration) || 30) {
            if (day === Number(old.day) && panel === Number(old.panel) && start === Number(old.startMinute)) continue;
            rest.push({ day, panel, start });
          }
        }
      }
      const attempts = [...exactFirst, ...rest];
      for (const candidate of attempts) {
        const candidates = shuffled(availableRooms);
        for (const room of candidates) {
          if (tryBook(sl, company, room, candidate.day, candidate.panel, candidate.start)) { placed = true; break; }
        }
        if (placed) break;
      }
    }
  }

  // Room recovery: preserve the complete current schedule and only consume the
  // current unscheduled shortlist queue using the newly available room.
  if (recovery && roomId) {
    const room = rooms.find(r => idOf(r) === String(roomId));
    if (room) {
      const queue = shuffled(activeShortlists.filter(x => !scheduledPairs.has(`${idOf(x.studentId)}-${idOf(x.companyId)}`)));
      queue.sort((a, b) => {
        const ac = scheduledRows.filter(x => idOf(x.studentId) === idOf(a.studentId)).length + additions.filter(x => idOf(x.studentId) === idOf(a.studentId)).length;
        const bc = scheduledRows.filter(x => idOf(x.studentId) === idOf(b.studentId)).length + additions.filter(x => idOf(x.studentId) === idOf(b.studentId)).length;
        return ac - bc || Math.random() - 0.5;
      });

      for (const sl of queue) {
        const company = companyMap.get(idOf(sl.companyId));
        if (!company) continue;
        const days = shuffled(companyDays(company));
        const panels = shuffled(Array.from({ length: Math.min(8, Number(company.panels) || 1) }, (_, i) => i + 1).filter(p => !(company.blockedPanels || []).includes(p)));
        let placed = false;
        for (const day of days) {
          for (const panel of panels) {
            const duration = Number(company.duration) || 30;
            for (let start = DAY_START; start + duration <= DAY_END; start += duration) {
              if (tryBook(sl, company, room, day, panel, start)) { placed = true; break; }
            }
            if (placed) break;
          }
          if (placed) break;
        }
      }
    }
  }

  if (additions.length) await Interview.insertMany(additions, { ordered: true });
  return additions;
}

export async function replanRoomAffected(affected, roomId) {
  return roomTargetedReplan({ affected, roomId, recovery: false });
}

export async function recoverRoomCapacity(roomId) {
  return roomTargetedReplan({ roomId, recovery: true });
}

export async function getSchedule() {
  return Interview.find({ status: "scheduled" })
    .populate("studentId", "studentCode name branch cgpa status")
    .populate("companyId", "name day days duration priority panels panelDetails startMinute endMinute")
    .populate("roomId", "name floor status capacity maxPanels maxCandidatesPerDay")
    .sort({ day: 1, startMinute: 1, companyId: 1 });
}
