import mongoose from "mongoose";
const DisruptionSchema = new mongoose.Schema({type:String,companyId:mongoose.Schema.Types.ObjectId,studentId:mongoose.Schema.Types.ObjectId,roomId:mongoose.Schema.Types.ObjectId,panel:Number,hours:Number,affectedCount:Number,movedCount:Number,unscheduledCount:Number,summary:String,details:[String],createdAt:{type:Date,default:Date.now}},{timestamps:false});
export default mongoose.model("Disruption",DisruptionSchema);
