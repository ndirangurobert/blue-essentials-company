# Blue Essentials Company — Store Management System

A responsive store-management and customer-ordering application for Blue Essentials Company.

## Planned modules
- Inventory and stock levels.
- Supplier purchases and purchase dates
- Sales and payment records
- Customer profiles and customer orders
- Employee accounts and role-based access
- Admin dashboard and reports

## Technology
- Cloudflare Workers for the application/API
- Cloudflare D1 (SQLite) for shared, persistent data
- Static frontend served by the Worker

## Setup
1. Create a D1 database named `blue-essentials-db` in Cloudflare.
2. Add its database ID to `wrangler.toml`.
3. Apply `database/migrations/0001_initial.sql`.
4. Connect this GitHub repository to the Cloudflare Worker and deploy.

This is the initial application scaffold. Authentication, permissions, and data-management screens must be completed and tested before real business data is entered.
