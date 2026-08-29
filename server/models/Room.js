import mongoose from "mongoose";
const RoomSchema = new mongoose.Schema({
  name:{type:String,unique:true},
  capacity:{type:Number,default:100,min:1,max:100},
  maxPanels:{type:Number,default:4,min:1,max:4},
  minActivePanels:{type:Number,default:3,min:1,max:8},
  maxCandidatesPerDay:{type:Number,default:100,min:1,max:100},
  floor:String,
  status:{type:String,enum:["available","unavailable"],default:"available"}
},{timestamps:true});
export default mongoose.model("Room",RoomSchema);
