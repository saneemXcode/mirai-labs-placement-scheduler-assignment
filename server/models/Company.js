import mongoose from "mongoose";
const CompanySchema = new mongoose.Schema({
  name:{type:String,required:true,unique:true},
  day:{type:Number,required:true},
  days:{type:[Number],default:[]},
  startMinute:{type:Number,default:540},
  endMinute:{type:Number,default:1020},
  panels:{type:Number,required:true,min:1,max:8},
  duration:{type:Number,required:true},
  cgpaCutoff:{type:Number,required:true},
  priority:{type:Number,default:3},
  shortlistCount:{type:Number,default:0},
  blockedPanels:{type:[Number],default:[]},
  panelDetails:[{number:Number,interviewers:[String]}]
},{timestamps:true});
export default mongoose.model("Company",CompanySchema);
