// server.js - Main Backend Server
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/college_timetable', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

// User Schema
const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin', 'faculty'], default: 'student' },
    college: { type: String, required: true },
    department: String,
    createdAt: { type: Date, default: Date.now }
});

// Subject Schema
const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    instructor: { type: String, required: true },
    department: { type: String, required: true },
    semester: { type: Number, required: true },
    credits: { type: Number, required: true },
    hoursPerWeek: { type: Number, required: true },
    type: { type: String, enum: ['theory', 'practical', 'tutorial'], default: 'theory' },
    prerequisites: [String],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// Timetable Schema
const TimetableSchema = new mongoose.Schema({
    courseName: { type: String, required: true },
    semester: { type: Number, required: true },
    department: { type: String, required: true },
    academicYear: { type: String, required: true },
    subjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
    schedule: {
        Monday: { type: Map, of: String },
        Tuesday: { type: Map, of: String },
        Wednesday: { type: Map, of: String },
        Thursday: { type: Map, of: String },
        Friday: { type: Map, of: String },
        Saturday: { type: Map, of: String }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Room Schema
const RoomSchema = new mongoose.Schema({
    roomNumber: { type: String, required: true, unique: true },
    capacity: { type: Number, required: true },
    type: { type: String, enum: ['classroom', 'laboratory', 'auditorium'], default: 'classroom' },
    facilities: [String],
    building: String,
    floor: Number,
    isActive: { type: Boolean, default: true }
});

// Models
const User = mongoose.model('User', UserSchema);
const Subject = mongoose.model('Subject', SubjectSchema);
const Timetable = mongoose.model('Timetable', TimetableSchema);
const Room = mongoose.model('Room', RoomSchema);

// JWT Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// AI Timetable Generator Class
class TimetableAI {
    constructor(subjects, rooms = [], constraints = {}) {
        this.subjects = subjects;
        this.rooms = rooms;
        this.constraints = constraints;
        this.timeSlots = [
            '09:00-10:00', '10:00-11:00', '11:00-12:00',
            '12:00-13:00', // Lunch break
            '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'
        ];
        this.days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        this.lunchSlot = '12:00-13:00';
    }

    generateOptimalSchedule() {
        const schedule = {};
        const occupiedSlots = new Set();
        const subjectHours = new Map();
        
        // Initialize schedule
        this.days.forEach(day => {
            schedule[day] = {};
            this.timeSlots.forEach(slot => {
                if (slot === this.lunchSlot) {
                    schedule[day][slot] = 'LUNCH_BREAK';
                } else {
                    schedule[day][slot] = null;
                }
            });
        });

        // Track subject hours assigned
        this.subjects.forEach(subject => {
            subjectHours.set(subject._id || subject.id, 0);
        });

        // Genetic Algorithm for optimization
        const population = this.generateInitialPopulation(50);
        const optimizedSchedule = this.evolveSchedule(population, 100);
        
        return optimizedSchedule || this.fallbackSchedule();
    }

    generateInitialPopulation(size) {
        const population = [];
        for (let i = 0; i < size; i++) {
            population.push(this.createRandomSchedule());
        }
        return population;
    }

    createRandomSchedule() {
        const schedule = {};
        const availableSlots = [];
        
        // Create available time slots
        this.days.forEach(day => {
            schedule[day] = {};
            this.timeSlots.forEach(slot => {
                if (slot === this.lunchSlot) {
                    schedule[day][slot] = 'LUNCH_BREAK';
                } else {
                    schedule[day][slot] = null;
                    availableSlots.push({ day, slot });
                }
            });
        });

        // Shuffle available slots
        this.shuffleArray(availableSlots);

        let slotIndex = 0;
        this.subjects.forEach(subject => {
            const slotsNeeded = subject.hoursPerWeek || 3;
            for (let i = 0; i < slotsNeeded && slotIndex < availableSlots.length; i++) {
                const { day, slot } = availableSlots[slotIndex];
                schedule[day][slot] = {
                    subjectId: subject._id || subject.id,
                    subject: subject.name,
                    instructor: subject.instructor,
                    type: subject.type || 'theory',
                    room: this.assignRoom(subject.type)
                };
                slotIndex++;
            }
        });

        return schedule;
    }

    evolveSchedule(population, generations) {
        for (let gen = 0; gen < generations; gen++) {
            // Calculate fitness for each schedule
            const scored = population.map(schedule => ({
                schedule,
                fitness: this.calculateFitness(schedule)
            }));

            // Sort by fitness (higher is better)
            scored.sort((a, b) => b.fitness - a.fitness);

            // Select best schedules for next generation
            const elite = scored.slice(0, Math.floor(population.length * 0.2));
            const newPopulation = elite.map(item => item.schedule);

            // Generate new schedules through crossover and mutation
            while (newPopulation.length < population.length) {
                const parent1 = this.selectParent(scored);
                const parent2 = this.selectParent(scored);
                const child = this.crossover(parent1, parent2);
                this.mutate(child);
                newPopulation.push(child);
            }

            population.splice(0, population.length, ...newPopulation);
        }

        return population[0];
    }

    calculateFitness(schedule) {
        let fitness = 100;
        
        // Penalize instructor conflicts
        this.days.forEach(day => {
            this.timeSlots.forEach(slot => {
                if (slot !== this.lunchSlot && schedule[day][slot]) {
                    const instructor = schedule[day][slot].instructor;
                    const conflicts = this.days.reduce((count, d) => {
                        return count + (d !== day && schedule[d][slot] && 
                               schedule[d][slot].instructor === instructor ? 1 : 0);
                    }, 0);
                    fitness -= conflicts * 10;
                }
            });
        });

        // Reward even distribution
        const dailyLoads = this.days.map(day => {
            return this.timeSlots.filter(slot => 
                slot !== this.lunchSlot && schedule[day][slot]
            ).length;
        });
        const avgLoad = dailyLoads.reduce((a, b) => a + b, 0) / dailyLoads.length;
        const variance = dailyLoads.reduce((sum, load) => sum + Math.pow(load - avgLoad, 2), 0);
        fitness -= variance;

        return fitness;
    }

    selectParent(scored) {
        const totalFitness = scored.reduce((sum, item) => sum + Math.max(0, item.fitness), 0);
        let random = Math.random() * totalFitness;
        
        for (const item of scored) {
            random -= Math.max(0, item.fitness);
            if (random <= 0) return item.schedule;
        }
        
        return scored[0].schedule;
    }

    crossover(parent1, parent2) {
        const child = {};
        this.days.forEach(day => {
            child[day] = {};
            this.timeSlots.forEach(slot => {
                if (Math.random() < 0.5) {
                    child[day][slot] = parent1[day][slot];
                } else {
                    child[day][slot] = parent2[day][slot];
                }
            });
        });
        return child;
    }

    mutate(schedule) {
        if (Math.random() < 0.1) { // 10% mutation rate
            const availableSlots = [];
            this.days.forEach(day => {
                this.timeSlots.forEach(slot => {
                    if (slot !== this.lunchSlot) {
                        availableSlots.push({ day, slot });
                    }
                });
            });
            
            const slot1 = availableSlots[Math.floor(Math.random() * availableSlots.length)];
            const slot2 = availableSlots[Math.floor(Math.random() * availableSlots.length)];
            
            // Swap slots
            const temp = schedule[slot1.day][slot1.slot];
            schedule[slot1.day][slot1.slot] = schedule[slot2.day][slot2.slot];
            schedule[slot2.day][slot2.slot] = temp;
        }
    }

    fallbackSchedule() {
        return this.createRandomSchedule();
    }

    assignRoom(subjectType) {
        if (this.rooms.length === 0) return 'TBA';
        
        const suitableRooms = this.rooms.filter(room => {
            if (subjectType === 'practical') return room.type === 'laboratory';
            if (subjectType === 'theory') return room.type === 'classroom';
            return true;
        });
        
        return suitableRooms.length > 0 ? 
               suitableRooms[Math.floor(Math.random() * suitableRooms.length)].roomNumber : 
               this.rooms[0].roomNumber;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

// Routes

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, college, department, role } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const user = new User({
            name,
            email,
            password: hashedPassword,
            college,
            department,
            role: role || 'student'
        });

        await user.save();

        // Generate JWT
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                college: user.college,
                department: user.department
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user._id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                college: user.college,
                department: user.department
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Subject Routes
app.get('/api/subjects', authenticateToken, async (req, res) => {
    try {
        const { department, semester } = req.query;
        const filter = {};
        
        if (department) filter.department = department;
        if (semester) filter.semester = parseInt(semester);

        const subjects = await Subject.find(filter).populate('createdBy', 'name');
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/subjects', authenticateToken, async (req, res) => {
    try {
        const subject = new Subject({
            ...req.body,
            createdBy: req.user.userId
        });
        await subject.save();
        res.status(201).json(subject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/subjects/:id', authenticateToken, async (req, res) => {
    try {
        const subject = await Subject.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        res.json(subject);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/subjects/:id', authenticateToken, async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: 'Subject deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Room Routes
app.get('/api/rooms', authenticateToken, async (req, res) => {
    try {
        const rooms = await Room.find({ isActive: true });
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/rooms', authenticateToken, async (req, res) => {
    try {
        const room = new Room(req.body);
        await room.save();
        res.status(201).json(room);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Timetable Routes
app.get('/api/timetables', authenticateToken, async (req, res) => {
    try {
        const { department, semester } = req.query;
        const filter = {};
        
        if (department) filter.department = department;
        if (semester) filter.semester = parseInt(semester);

        const timetables = await Timetable.find(filter)
            .populate('subjects')
            .populate('createdBy', 'name');
        res.json(timetables);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/timetables/generate', authenticateToken, async (req, res) => {
    try {
        const { courseName, semester, department, subjectIds, academicYear } = req.body;

        // Get subjects
        const subjects = await Subject.find({ _id: { $in: subjectIds } });
        
        // Get available rooms
        const rooms = await Room.find({ isActive: true });

        // Generate AI timetable
        const aiGenerator = new TimetableAI(subjects, rooms);
        const schedule = aiGenerator.generateOptimalSchedule();

        // Save timetable
        const timetable = new Timetable({
            courseName,
            semester: parseInt(semester),
            department,
            academicYear: academicYear || new Date().getFullYear().toString(),
            subjects: subjectIds,
            schedule,
            createdBy: req.user.userId
        });

        await timetable.save();
        await timetable.populate('subjects');

        res.json({
            message: 'Timetable generated successfully',
            timetable,
            schedule
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/timetables/:id', authenticateToken, async (req, res) => {
    try {
        const timetable = await Timetable.findById(req.params.id)
            .populate('subjects')
            .populate('createdBy', 'name');
        
        if (!timetable) {
            return res.status(404).json({ error: 'Timetable not found' });
        }

        res.json(timetable);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/timetables/:id', authenticateToken, async (req, res) => {
    try {
        const timetable = await Timetable.findByIdAndUpdate(
            req.params.id,
            { ...req.body, updatedAt: new Date() },
            { new: true }
        ).populate('subjects');

        res.json(timetable);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/timetables/:id', authenticateToken, async (req, res) => {
    try {
        await Timetable.findByIdAndDelete(req.params.id);
        res.json({ message: 'Timetable deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analytics Routes
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
    try {
        const totalSubjects = await Subject.countDocuments();
        const totalTimetables = await Timetable.countDocuments();
        const totalRooms = await Room.countDocuments({ isActive: true });
        const totalUsers = await User.countDocuments();

        // Recent activity
        const recentTimetables = await Timetable.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('createdBy', 'name')
            .populate('subjects', 'name');

        res.json({
            stats: {
                totalSubjects,
                totalTimetables,
                totalRooms,
                totalUsers
            },
            recentActivity: recentTimetables
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});