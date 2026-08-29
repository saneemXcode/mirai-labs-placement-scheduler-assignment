import mongoose from "mongoose";
const StudentSchema = new mongoose.Schema({
  studentCode:{type:String,unique:true,index:true}, name:{type:String,required:true,unique:true}, branch:String, cgpa:Number,
  status:{type:String,enum:["Eligible","Withdrawn","Ineligible","Placed","Withdrawn + Placed"],default:"Eligible"},
  placedCompanyId:{type:mongoose.Schema.Types.ObjectId,ref:"Company",default:null},
  shortlistedCompanySnapshot:{type:[String],default:[]}
},{timestamps:true});
export default mongoose.model("Student",StudentSchema);
