import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import crypto from "crypto";
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

// ── Helper: get or create profile ──
async function getProfile() {
  let doc = await db.collection("profile").findOne({});
  if (!doc) {
    const template = {
      name: "",
      role: "",
      personalInfo: { age: "", city: "", state: "" },
      skills: [],
      projects: [],
      education: { degree: "", branch: "", puc: { percentage: "" }, sslc: { percentage: "" } },
      hobbies: [],
      contact: { email: "" },
      socialProfiles: { github: "", linkedin: "" },
    };
    await db.collection("profile").insertOne(template);
    doc = await db.collection("profile").findOne({});
  }
  return doc;
}

// ── Auth helpers ──
const activeSessions = new Map(); // token -> { createdAt }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function ensureAdminPassword() {
  const existing = await db.collection("settings").findOne({ key: "admin_password" });
  if (!existing) {
    await db.collection("settings").insertOne({ key: "admin_password", value: "admin123" });
    console.log("🔑 Default admin password set to: admin123");
  }
}

function authMiddleware(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const session = activeSessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    activeSessions.delete(token);
    return res.status(401).json({ error: "Session expired, please log in again" });
  }
  next();
}

// ════════════════════════════════════════════
// AUTH — login, verify, change password
// ════════════════════════════════════════════
app.post("/api/auth/login", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required" });
    const doc = await db.collection("settings").findOne({ key: "admin_password" });
    if (!doc || doc.value !== password) {
      return res.status(401).json({ error: "Invalid password" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    activeSessions.set(token, { createdAt: Date.now() });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/auth/verify", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (!token) return res.json({ valid: false });
  const session = activeSessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    activeSessions.delete(token);
    return res.json({ valid: false });
  }
  res.json({ valid: true });
});

app.put("/api/auth/password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: "New password must be at least 4 characters" });
    }
    const doc = await db.collection("settings").findOne({ key: "admin_password" });
    if (!doc || doc.value !== currentPassword) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    await db.collection("settings").updateOne(
      { key: "admin_password" },
      { $set: { value: newPassword } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// READ — full profile (public)
// ════════════════════════════════════════════
app.get("/api/profile", async (req, res) => {
  try {
    const data = await getProfile();
    const { _id, ...rest } = data;
    res.json(rest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// UPDATE — hero / personal info
// ════════════════════════════════════════════
app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const { name, role, age, city, state } = req.body;
    await db.collection("profile").updateOne(
      {},
      {
        $set: {
          name,
          role,
          "personalInfo.age": age,
          "personalInfo.city": city,
          "personalInfo.state": state,
        },
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// SKILLS — add & delete
// ════════════════════════════════════════════
app.post("/api/profile/skills", authMiddleware, async (req, res) => {
  try {
    const { skill } = req.body;
    if (!skill) return res.status(400).json({ error: "Skill is required" });
    await db.collection("profile").updateOne({}, { $addToSet: { skills: skill } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/profile/skills/:skill", authMiddleware, async (req, res) => {
  try {
    const skill = decodeURIComponent(req.params.skill);
    await db.collection("profile").updateOne({}, { $pull: { skills: skill } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// PROJECTS — add, update, delete
// ════════════════════════════════════════════
app.post("/api/profile/projects", authMiddleware, async (req, res) => {
  try {
    const project = req.body;
    if (!project.name) return res.status(400).json({ error: "Project name is required" });
    // ensure arrays
    project.features = project.features || [];
    project.techStack = project.techStack || [];
    project.databaseDesign = project.databaseDesign || "";
    await db.collection("profile").updateOne({}, { $push: { projects: project } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/profile/projects/:index", authMiddleware, async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    const project = req.body;
    project.features = project.features || [];
    project.techStack = project.techStack || [];
    project.databaseDesign = project.databaseDesign || "";
    const key = `projects.${idx}`;
    await db.collection("profile").updateOne({}, { $set: { [key]: project } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/profile/projects/:index", authMiddleware, async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    // MongoDB doesn't support direct array removal by index,
    // so we set to null then pull nulls
    const doc = await getProfile();
    const projects = doc.projects || [];
    if (idx < 0 || idx >= projects.length) return res.status(404).json({ error: "Invalid index" });
    projects.splice(idx, 1);
    await db.collection("profile").updateOne({}, { $set: { projects } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// EDUCATION — update
// ════════════════════════════════════════════
app.put("/api/profile/education", authMiddleware, async (req, res) => {
  try {
    const { degree, branch, pucPercentage, sslcPercentage } = req.body;
    await db.collection("profile").updateOne(
      {},
      {
        $set: {
          "education.degree": degree,
          "education.branch": branch,
          "education.puc.percentage": pucPercentage,
          "education.sslc.percentage": sslcPercentage,
        },
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// HOBBIES — update (replace entire array)
// ════════════════════════════════════════════
app.put("/api/profile/hobbies", authMiddleware, async (req, res) => {
  try {
    const { hobbies } = req.body;
    await db.collection("profile").updateOne({}, { $set: { hobbies } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
// CONTACT & SOCIAL — update
// ════════════════════════════════════════════
app.put("/api/profile/contact", authMiddleware, async (req, res) => {
  try {
    const { email, github, linkedin } = req.body;
    await db.collection("profile").updateOne(
      {},
      {
        $set: {
          "contact.email": email,
          "socialProfiles.github": github,
          "socialProfiles.linkedin": linkedin,
        },
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback route for frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

connectDB().then(async () => {
  await ensureAdminPassword();
  app.listen(PORT, () =>
    console.log(`🚀 Running at http://localhost:${PORT}`)
  );
});
