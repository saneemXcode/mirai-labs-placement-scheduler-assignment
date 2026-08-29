import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Company from "../models/Company.js";
import Student from "../models/Student.js";
import Room from "../models/Room.js";
import Shortlist from "../models/Shortlist.js";
import Interview from "../models/Interview.js";
import Disruption from "../models/Disruption.js";
import ScheduleConfig from "../models/ScheduleConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readJson = name => fs.readFile(path.join(__dirname, "data", name), "utf8").then(JSON.parse);

const firstNames = ["Aditya","Aarav","Akshay","Anil","Arjun","Chetan","Deepak","Girish","Harish","Ishaan","Kiran","Manoj","Naveen","Nikhil","Pranav","Rakesh","Ravi","Siddharth","Suresh","Varun","Vivek","Yash","Aditi","Anjali","Ananya","Asha","Bhavna","Deepa","Diya","Hema","Ira","Ishita","Kavitha","Lakshmi","Madhuri","Maya","Megha","Nandini","Neha","Nisha","Pallavi","Priyanka","Reema","Rekha","Riya","Sahana","Sanjana","Shreya","Simran","Sonal","Sowmya","Swati","Tanvi"];
const lastNames = ["Bhat","Nair","Rao","Das","Menon","Jain","Kapoor","Joshi","Shah","Iyer","Shetty","Pai","Thomas","Joseph","Kumar","Mehta","Reddy","Kulkarni","Naik","Menezes","D'Souza","Prasad"];
const interviewerPool = [...new Set(firstNames.flatMap(f => lastNames.map(l => `${f} ${l}`)))];

function shuffle(list){
  const a=[...list];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function chooseDays(raw, index, massNames){
  const rawDays=[...(raw.days||[raw.day])].map(Number).filter(d=>d>=1&&d<=4);
  const day1=Number(raw.day)===1;
  const pool=[1,2,3,4];
  if(massNames.has(raw.name)) {
    const extra = shuffle([2,3,4]).slice(0, 1 + Math.floor(Math.random() * 2));
    return shuffle([1, ...extra]).sort((a,b)=>a-b);
  }
  // Every company gets at least one day. A substantial randomized subset gets
  // 2 or 3 days so the four-day schedule has enough panel capacity.
  const count = Math.random()<0.48 ? 3 : Math.random()<0.72 ? 2 : 1;
  const preferred=shuffle([...new Set([...rawDays,...pool])]);
  let days=preferred.slice(0,count);
  if(day1 && !days.includes(1)) days[0]=1;
  days=[...new Set(days)].sort((a,b)=>a-b);
  return days.length?days:[(index%4)+1];
}

function normalizeCompanyData(raw, massNames){
  let cursor=0;
  return raw.map((c,index)=>{
    const days=chooseDays(c,index,massNames);
    const panels=Math.max(1,Math.min(8,Number(c.panels)||1));
    const panelDetails=Array.from({length:panels},(_,idx)=>{
      const a=interviewerPool[cursor++ % interviewerPool.length];
      const b=interviewerPool[cursor++ % interviewerPool.length];
      return {number:idx+1,interviewers:[a,b]};
    });
    return {
      ...c,
      day:days[0],
      days,
      startMinute:540,
      endMinute:1020,
      panels,
      duration:Math.max(15,Math.min(120,Number(c.duration)||30)),
      panelDetails,
      blockedPanels:[],
      massRecruiter:massNames.has(c.name),
      shortlistCount:0,
      priority:Number(c.priority)||3
    };
  });
}

function chooseCompanyForStudent(student, eligible, companyState){
  const available=eligible.filter(c=>companyState.get(String(c._id)).count<companyState.get(String(c._id)).limit);
  if(!available.length)return null;
  const weighted=available.flatMap(c=>{
    const state=companyState.get(String(c._id));
    const massWeight=state.mass?6:2;
    const remainingWeight=Math.max(1,Math.ceil((state.limit-state.count)/15));
    return Array.from({length:massWeight+remainingWeight},()=>c);
  });
  return weighted[Math.floor(Math.random()*weighted.length)];
}

export async function generateData() {
  await Interview.deleteMany({});
  await Shortlist.deleteMany({});
  await Disruption.deleteMany({});
  await ScheduleConfig.deleteMany({});
  await Company.deleteMany({});
  await Student.deleteMany({});
  await Room.deleteMany({});

  const [studentData, rawCompanyData, roomData] = await Promise.all([
    readJson("students.json"), readJson("companies.json"), readJson("rooms.json")
  ]);
  if(studentData.length!==800) throw new Error(`students.json must contain exactly 800 students; found ${studentData.length}.`);
  if(rawCompanyData.length!==35) throw new Error(`companies.json must contain exactly 35 companies; found ${rawCompanyData.length}.`);
  if(roomData.length!==20) throw new Error(`rooms.json must contain exactly 20 rooms; found ${roomData.length}.`);

  const names=new Set(studentData.map(s=>s.name));
  const codes=new Set(studentData.map(s=>s.studentCode));
  const companyNames=new Set(rawCompanyData.map(c=>c.name));
  if(names.size!==studentData.length) throw new Error("students.json contains duplicate student names.");
  if(codes.size!==studentData.length) throw new Error("students.json contains duplicate student codes.");
  if(companyNames.size!==rawCompanyData.length) throw new Error("companies.json contains duplicate company names.");

  // Amazon and TCS are always mass recruiters. Add 0-2 other Day-1 companies
  // so each generation has between 2 and 4 mass recruiters in total.
  const day1Names=rawCompanyData.filter(c=>Number(c.day)===1).map(c=>c.name).filter(n=>!['Amazon','Tata Consultancy Services'].includes(n));
  const extraCount=Math.floor(Math.random()*3); // 0, 1 or 2
  const extraMass=shuffle(day1Names).slice(0,extraCount);
  const massNames=new Set(['Amazon','Tata Consultancy Services',...extraMass]);

  const companyData=normalizeCompanyData(rawCompanyData,massNames);
  const companyDocs=await Company.insertMany(companyData);
  const studentDocs=await Student.insertMany(studentData);
  const normalizedRooms=roomData.map(r=>({
    ...r,
    capacity:Math.max(1,Math.min(100,Number(r.capacity)||100)),
    maxPanels:Math.max(1,Math.min(4,Number(r.maxPanels)||4)),
    minActivePanels:Math.max(1,Math.min(8,Number(r.minActivePanels)||3)),
    maxCandidatesPerDay:Math.max(1,Math.min(100,Number(r.maxCandidatesPerDay)||100)),
    status:"available"
  }));
  await Room.insertMany(normalizedRooms);

  // Every company has a hard shortlist ceiling below 170. Mass recruiters
  // receive 125-169 students; all others receive a randomized 45-169 target.
  const companyState=new Map();
  for(const c of companyDocs){
    const isMass=massNames.has(c.name);
    const limit=isMass ? 125+Math.floor(Math.random()*45) : 45+Math.floor(Math.random()*125); // 125..169 / 45..169
    companyState.set(String(c._id),{count:0,limit,mass:isMass});
  }

  const shortlist=[];
  const pairSet=new Set();
  const eligibleByStudent=new Map();
  for(const s of studentDocs){
    const eligible=companyDocs.filter(c=>Number(s.cgpa)>=Number(c.cgpaCutoff));
    if(!eligible.length) throw new Error(`Student ${s.studentCode} has no eligible company; cannot satisfy the 800-student shortlist requirement.`);
    eligibleByStudent.set(String(s._id),eligible);
  }

  // Pass 1 guarantees all 800 students have at least one shortlist.
  for(const s of shuffle(studentDocs)){
    const c=chooseCompanyForStudent(s,eligibleByStudent.get(String(s._id)),companyState);
    if(!c) throw new Error(`Could not allocate a first shortlist for ${s.studentCode}.`);
    pairSet.add(`${s._id}-${c._id}`); companyState.get(String(c._id)).count++;
    shortlist.push({studentId:s._id,companyId:c._id});
  }

  // Guarantee Amazon/TCS mass-recruiter volume.
  for(const massName of ['Amazon','Tata Consultancy Services']){
    const company=companyDocs.find(c=>c.name===massName);
    if(!company)continue;
    const state=companyState.get(String(company._id));
    const minimum=125+Math.floor(Math.random()*21); // 125..145
    const eligible=shuffle(studentDocs.filter(s=>Number(s.cgpa)>=Number(company.cgpaCutoff)));
    for(const s of eligible){
      if(state.count>=minimum || state.count>=state.limit)break;
      const key=`${s._id}-${company._id}`;
      if(pairSet.has(key))continue;
      pairSet.add(key); state.count++; shortlist.push({studentId:s._id,companyId:company._id});
    }
  }

  // The total shortlist pool is randomized on every Generate/Reset.
  const targetShortlists=2800+Math.floor(Math.random()*301); // 2800..3100
  const shuffledStudents=shuffle(studentDocs);
  let cursor=0, safety=0;
  while(shortlist.length<targetShortlists && safety<500000){
    safety++;
    const s=shuffledStudents[cursor%shuffledStudents.length]; cursor++;
    const eligible=eligibleByStudent.get(String(s._id));
    const currentCompanies=new Set(shortlist.filter(x=>String(x.studentId)===String(s._id)).map(x=>String(x.companyId)));
    const candidates=eligible.filter(c=>!currentCompanies.has(String(c._id)) && companyState.get(String(c._id)).count<companyState.get(String(c._id)).limit);
    if(!candidates.length)continue;
    const c=chooseCompanyForStudent(s,candidates,companyState);
    if(!c)continue;
    const key=`${s._id}-${c._id}`;
    if(pairSet.has(key))continue;
    pairSet.add(key); companyState.get(String(c._id)).count++; shortlist.push({studentId:s._id,companyId:c._id});
  }
  if(shortlist.length<targetShortlists)throw new Error(`Could only create ${shortlist.length} shortlist records; target was ${targetShortlists}.`);

  await Shortlist.insertMany(shortlist,{ordered:true});
  await Promise.all(companyDocs.map(c=>Company.findByIdAndUpdate(c._id,{$set:{shortlistCount:companyState.get(String(c._id)).count}})));

  // Strictly >60% and <=70% target. The scheduler is expected to meet this
  // target; /seed verifies the resulting percentage before reporting success.
  const targetPercent=Number((60.1+Math.random()*9.9).toFixed(1));
  const targetInterviewCount=Math.round(shortlist.length*targetPercent/100);
  await ScheduleConfig.create({targetPercent,targetInterviewCount});

  return {companies:companyDocs.length,students:studentDocs.length,rooms:normalizedRooms.length,shortlists:shortlist.length,targetPercent,targetInterviewCount,massRecruiters:[...massNames]};
}
