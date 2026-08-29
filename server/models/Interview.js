import mongoose from "mongoose";
const InterviewSchema = new mongoose.Schema({studentId:{type:mongoose.Schema.Types.ObjectId,ref:"Student"},companyId:{type:mongoose.Schema.Types.ObjectId,ref:"Company"},roomId:{type:mongoose.Schema.Types.ObjectId,ref:"Room"},day:Number,startMinute:Number,endMinute:Number,panel:Number,status:{type:String,enum:["scheduled","withdrawn","cancelled"],default:"scheduled"},cancellationReason:String},{timestamps:true});
export default mongoose.model("Interview",InterviewSchema);
