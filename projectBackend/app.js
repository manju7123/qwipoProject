const express = require('express');
const cors = require('cors');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'customerData.db');
const app = express();

app.use(express.json());
app.use(cors());

let db = null;

const initializeDbAndServer = async () => {
    try {
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database,
        });

        await db.run(`
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                first_name TEXT,
                last_name TEXT,
                phone TEXT,
                email TEXT
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER,
                address TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers (id)
            )
        `);

        app.listen(3005, () => {
            console.log('Server Running at http://localhost:3005/');
        });
    } catch (error) {
        console.error(`DB Error: ${error.message}`);
        process.exit(1);
    }
};

initializeDbAndServer();

// Create a new customer with multiple addresses
app.post('/api/customers', async (req, res) => {
    const { firstName, lastName, phone, email, addresses } = req.body;

    if (!firstName || !lastName || !phone || !email || !addresses || !Array.isArray(addresses)) {
        return res.status(400).json({ error: "All fields are required and addresses must be an array" });
    }

    try {
        await db.run('BEGIN TRANSACTION');

        const result = await db.run(`
            INSERT INTO customers (first_name, last_name, phone, email) 
            VALUES (?, ?, ?, ?)
        `, [firstName, lastName, phone, email]);

        const customerId = result.lastID;

        for (const address of addresses) {
            await db.run(`
                INSERT INTO addresses (customer_id, address) 
                VALUES (?, ?)
            `, [customerId, address]);
        }

        await db.run('COMMIT');
        res.json({ message: "Customer and addresses added successfully" });
    } catch (err) {
        await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

// Get all customers with pagination, search, and filter
app.get('/api/customers', async (req, res) => {
    const { page = 1, pageSize = 10, search = '', address = '' } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = `SELECT * FROM customers WHERE first_name LIKE ? OR last_name LIKE ?`;
    let params = [`%${search}%`, `%${search}%`];

    if (address) {
        sql += ` AND EXISTS (
            SELECT 1 
            FROM addresses 
            WHERE addresses.customer_id = customers.id 
            AND addresses.address LIKE ?
        )`;
        params.push(`%${address}%`);
    }

    sql += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(pageSize), offset);

    try {
        const customers = await db.all(sql, params);
        const totalCustomers = await db.get('SELECT COUNT(*) AS count FROM customers');
        const totalPages = Math.ceil(totalCustomers.count / pageSize);

        for (let customer of customers) {
            const addresses = await db.all(`SELECT address FROM addresses WHERE customer_id = ?`, [customer.id]);
            customer.addresses = addresses.map(a => a.address);
        }

        res.json({ customers, totalPages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer by ID
app.get('/api/customers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const customer = await db.get(`SELECT * FROM customers WHERE id = ?`, [id]);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        const addresses = await db.all(`SELECT address FROM addresses WHERE customer_id = ?`, [id]);
        customer.addresses = addresses.map(a => a.address);

        res.json(customer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update customer details and multiple addresses
app.put('/api/customers/:id', async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, phone, email, addresses } = req.body;

    if (!firstName || !lastName || !phone || !email || !addresses || !Array.isArray(addresses)) {
        return res.status(400).json({ error: "All fields are required and addresses must be an array" });
    }

    try {
        await db.run('BEGIN TRANSACTION');

        // Update customer details
        await db.run(`
            UPDATE customers 
            SET first_name = ?, last_name = ?, phone = ?, email = ? 
            WHERE id = ?
        `, [firstName, lastName, phone, email, id]);

        // Delete existing addresses and insert new ones
        await db.run(`DELETE FROM addresses WHERE customer_id = ?`, [id]);
        for (const address of addresses) {
            await db.run(`
                INSERT INTO addresses (customer_id, address) 
                VALUES (?, ?)
            `, [id, address]);
        }

        await db.run('COMMIT');
        res.json({ message: 'Customer and addresses updated successfully' });
    } catch (err) {
        await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

// Delete customer and their addresses
app.delete('/api/customers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        await db.run('BEGIN TRANSACTION');
        await db.run(`DELETE FROM addresses WHERE customer_id = ?`, [id]);
        await db.run(`DELETE FROM customers WHERE id = ?`, [id]);

        await db.run('COMMIT');
        res.json({ message: 'Customer and associated addresses deleted successfully' });
    } catch (err) {
        await db.run('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

// Add a new address for a customer
app.post('/api/customers/:id/addresses', async (req, res) => {
    const { id } = req.params;
    const { address } = req.body;

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }

    try {
        // Check if the customer exists
        const customer = await db.get('SELECT 1 FROM customers WHERE id = ?', [id]);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Insert the new address
        await db.run(`
            INSERT INTO addresses (customer_id, address) 
            VALUES (?, ?)
        `, [id, address]);

        res.json({ message: 'Address added successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all addresses for a customer
app.get('/api/customers/:id/addresses', async (req, res) => {
    const { id } = req.params;

    try {
        // Check if the customer exists
        const customer = await db.get('SELECT 1 FROM customers WHERE id = ?', [id]);
        if (!customer) {
            return res.status(404).json({ error: 'Customer not found' });
        }

        // Retrieve addresses
        const addresses = await db.all('SELECT address FROM addresses WHERE customer_id = ?', [id]);
        res.json(addresses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;
