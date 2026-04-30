import express from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// MongoDB
const MONGO_URI = process.env.MONGO_URI;
let db;

async function connectDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db("myProfileDB");
    console.log("✅ Connected to MongoDB Atlas");
  } catch (error) {
    console.error("❌ DB Error:", error);
    process.exit(1);
  }
}

// API
app.get("/api/profile", async (req, res) => {
  try {
    const data = await db
      .collection("profile")
      .findOne({}, { projection: { _id: 0 } });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback route for frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

connectDB().then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Running at http://localhost:${PORT}`)
  );
});
