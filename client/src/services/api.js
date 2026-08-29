import axios from 'axios';
export const api=axios.create({baseURL:'http://localhost:5000/api'});
export const getSummary=()=>api.get('/summary');
export const getInterviews=()=>api.get('/interviews',{params:{limit:10000}});
export const seed=()=>api.post('/seed');
export const replan=data=>api.post('/replan',data);
export const getCompanies=()=>api.get('/companies');
export const getStudents=()=>api.get('/students',{params:{limit:800}});
export const getRooms=()=>api.get('/rooms');
export const getDisruptions=()=>api.get('/disruptions');
export const changeStudentStatus=(id,status,companyId)=>api.post(`/students/${id}/status`,{status,companyId});
export const changeRoomStatus=(id,status)=>api.post(`/rooms/${id}/status`,{status});

export const getUnscheduledStudents=()=>api.get('/unscheduled-students');
