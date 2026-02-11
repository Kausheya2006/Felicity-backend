const mongoose = require('mongoose');

async function connectDB() {
    const uri = process.env.MONGO_URI;
    if (!uri) 
        throw new Error("MONGO_URI is not defined in environment variables");

    try {
        const conn = await mongoose.connect(uri, {

        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
        return conn;

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

module.exports = connectDB;