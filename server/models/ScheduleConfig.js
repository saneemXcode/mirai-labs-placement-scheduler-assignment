import mongoose from "mongoose";
const ScheduleConfigSchema = new mongoose.Schema({
  targetPercent:{type:Number,min:60,max:70,required:true},
  targetInterviewCount:{type:Number,required:true},
  createdAt:{type:Date,default:Date.now}
},{timestamps:false});
export default mongoose.model("ScheduleConfig",ScheduleConfigSchema);
