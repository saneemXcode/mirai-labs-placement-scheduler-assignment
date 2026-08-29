import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import api from "./routes/api.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", api);

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/mirai_placement_scheduler";

mongoose.connect(MONGO_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
