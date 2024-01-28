import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
const PORT = 4000;
const mongoURL = "mongodb://127.0.0.1:27017"; // for some godforsaken reason despite being correctly configured using "localhost" kept failing.
const dbName = "quirknotes";

// Connect to MongoDB
let db;

async function connectToMongo() {
  const client = new MongoClient(mongoURL);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    db = client.db(dbName);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}

connectToMongo();

// Open Port
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Collections to manage
const COLLECTIONS = {
    notes: "notes",
    users: "users",
};

// Register a new user (Use POST request in Postman)
app.post("/registerUser", express.json(), async (req, res) => {
    console.log("Received a registerUser request...");
    try {
      const { username, password } = req.body;
  
      // Basic body request check
      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password both needed to register." });
      }
  
      // Checking if username does not already exist in database
      const userCollection = db.collection(COLLECTIONS.users);
      const existingUser = await userCollection.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists." });
      }
  
      // Creating hashed password (search up bcrypt online for more info)
      // and storing user info in database
      const hashedPassword = await bcrypt.hash(password, 10);
      await userCollection.insertOne({
        username,
        password: hashedPassword,
      });
  
      // Returning JSON Web Token (search JWT for more explanation)
      const token = jwt.sign({ username }, "secret-key", { expiresIn: "1h" });
      res.status(201).json({ response: "User registered successfully.", token });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// Log in an existing user
app.post("/loginUser", express.json(), async (req, res) => {
    try {
      const { username, password } = req.body;
  
      // Basic body request check
      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password both needed to login." });
      }
  
      // Find username in database
      const userCollection = db.collection(COLLECTIONS.users);
      const user = await userCollection.findOne({ username });
  
      // Validate user against hashed password in database
      if (user && (await bcrypt.compare(password, user.password))) {
        const token = jwt.sign({ username }, "secret-key", { expiresIn: "1h" });
  
        // Send JSON Web Token to valid user
        res.json({ response: "User logged in succesfully.", token: token }); //Implicitly status 200
      } else {
        res.status(401).json({ error: "Authentication failed." });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// Post a note belonging to the user
app.post("/postNote", express.json(), async (req, res) => {
    try {
      // Basic body request check
      const { title, content } = req.body;
      if (!title || !content) {
        return res
          .status(400)
          .json({ error: "Title and content are both required." });
      }
  
      // Verify the JWT from the request headers
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, "secret-key", async (err, decoded) => {
        if (err) {
          return res.status(401).send("Unauthorized.");
        }
  
        // Send note to database
        const collection = db.collection(COLLECTIONS.notes);
        const result = await collection.insertOne({
          title,
          content,
          username: decoded.username,
        });

        res.json({
          response: "Note added succesfully.",
          insertedId: result.insertedId,
        });
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// Retrieve a note belonging to the user
app.get("/getNote/:noteId", express.json(), async (req, res) => {
    try {
      // Basic param checking
      const noteId = req.params.noteId;
      if (!ObjectId.isValid(noteId)) {
        return res.status(400).json({ error: "Invalid note ID." });
      }
  
      // Verify the JWT from the request headers
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, "secret-key", async (err, decoded) => {
        if (err) {
          return res.status(401).send("Unauthorized.");
        }
  
        // Find note with given ID
        const collection = db.collection(COLLECTIONS.notes);
        const data = await collection.findOne({
          username: decoded.username,
          _id: new ObjectId(noteId),
        });
        if (!data) {
          return res
            .status(404)
            .json({ error: "Unable to find note with given ID." });
        }
        res.json({ response: data });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

/////////////// Now comes the fun part...

// lab endpoint 1: /getAllNotes. Returns all existing notes for a specific user.
app.get("/getAllNotes/:username", express.json(), async (req, res) => {
  // Need a 200 success, a 401 unauth, and a 500 internal error.
  try {
    // Check basics:
    const username = req.params.username;
    // validate the username exists or return a 404.
    if (!username) {
      return res.status(400).json({ error: "GIVE A USERNAME DINGUS" });
    }
    const user = await db.collection(COLLECTIONS.users).findOne({ username: username});
    const userExists = user !== null;
    if (!userExists) {
      return res.status(404).json({ error: "No user by that name. try again :)" });
    }

    // Verify Authorisation in JWT:
    const token = req.headers.authorization.split(" ")[1]; 
    // also check this auth token against the user's hashed password or 401:
    jwt.verify(token, "secret-key", async (err) => { 
      if (err) {
        return res.status(401).send("naughty naughty. unauthorised!! >:(");
      }
        // To break the security above you'd need to know both the user's username and their password. This is sufficient.
      const collection = db.collection(COLLECTIONS.notes);
      const data = await collection.find({ username: username }).toArray((err, notes) => {
        if (err) {
          console.error("Error retrieving notes", err.message);
          return res.status(500).json({ message: "Note retrieval error", error: err.message });
        }
      });
      if (!data || data.length === 0 ) {
        return res.json({ response: [] });
      }
      return res.status(200).json({ response: data });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// lab endpoint 2: delete notes:
app.delete("/deleteNote/:noteId", express.json(), async (req, res) => {
  try {
    // Basic param checking
    const noteId = req.params.noteId;
    if (!ObjectId.isValid(noteId)) {
      return res.status(400).json({ error: "Invalid note ID." });
    }

    // Verify the JWT from the request headers
    const token = req.headers.authorization.split(" ")[1];
    // So from testing it looks like each password is hashed differently even if it's the same. This means it's as unique as the username, thank god.
    // const user = await db.collection(COLLECTIONS.users).findOne({ password: token });
    jwt.verify(token, "secret-key", async (err, decoded) => {
      if (err) { 
        return res.status(401).send("Unauthorized.");
      }

      // Find note with given ID
      const collection = db.collection(COLLECTIONS.notes);
      const note = await collection.findOne({ _id: new ObjectId(noteId) });

      // Check if the note exists
      if (!note) {
        return res.status(404).json({ error: "Note not found." });
      }

      // Check if the note belongs to the authenticated user
      if (note.username !== decoded.username) {
        return res.status(401).json({ error: "Unauthorised." });
      }

      const data = await collection.deleteOne({
        username: decoded.username,
        _id: new ObjectId(noteId),
      }).then(result => {
        if (result.deletedCount === 1) {
          console.log("Successfully deleted a note");
          return res.status(200).json({ response: "Document with ID ${noteId} properly deleted" })
        }
        else {
          return res.status(500).json({ response: "Failed to delete Note." })
      }
    });

   });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// lab endpoint 3: Patch request, editNote:
app.patch("/editNote/:noteId", express.json(), async (req, res) => {
  try {
    // Basic param checking
    const noteId = req.params.noteId;
    if (!ObjectId.isValid(noteId)) {
      return res.status(400).json({ error: "Invalid note ID." });
    }

    const { title, content } = req.body;
    if (!title && !content) {
      return res.status(400).json({ error: "No changes provided." });
    }

    // Verify the JWT from the request headers
    const token = req.headers.authorization.split(" ")[1];
    //TODO: Try and get Username from Token:


    jwt.verify(token, "secret-key", async (err, decoded) => {
      if (err) { // TODO: reject if note has a different username:
        return res.status(401).send("Unauthorized.");
      }

      // Find note with given ID
      const collection = db.collection(COLLECTIONS.notes);
      const note = await collection.findOne({ _id: new ObjectId(noteId) });

      // Check if the note exists
      if (!note) {
        return res.status(404).json({ error: "Note not found." });
      }

      // Check if the note belongs to the authenticated user
      if (note.username !== decoded.username) {
        return res.status(401).json({ error: "Unauthorised." });
      }
      

      //Editing logic:
      const updateFields = {};
      if (title) updateFields.title = title;
      if (content) updateFields.content = content;

      const result = await collection.updateOne(
        { _id: new ObjectId(noteId) },
        { $set: updateFields }
      );

      if (result.modifiedCount === 1) {
        res.status(200).json({ response: "Document with ID ${noteId} properly updated" });
      } else {
        res.status(500).json({ error: "No changes made." });
      }

    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});