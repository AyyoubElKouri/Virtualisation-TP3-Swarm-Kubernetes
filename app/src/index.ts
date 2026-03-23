import express, { Request, Response } from "express";
import os from "os";

const app = express();
app.use(express.json());

interface Task {
  id: number;
  title: string;
}
let tasks: Task[] = [
    { id: 1, title: "Tâche 1" },
    { id: 2, title: "Tâche 2" }
];
let nextId = 3;

app.get("/info", (_req: Request, res: Response) => {
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: os.uptime(),
  });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", hostname: os.hostname() });
});

app.get("/tasks", (_req: Request, res: Response) => {
  res.json({ tasks, count: tasks.length, servedBy: os.hostname() });
});

app.post("/tasks", (req: Request, res: Response) => {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ error: "Le champ 'title' est requis" });
    return;
  }
  const task: Task = { id: nextId++, title };
  tasks.push(task);
  res.status(201).json({ task, servedBy: os.hostname() });
});

const PORT = parseInt(process.env.PORT || "3000");
app.listen(PORT, () => {
  console.log(`[${os.hostname()}] API démarrée sur le port ${PORT}`);
});
