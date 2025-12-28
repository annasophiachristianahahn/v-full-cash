#!/bin/bash

# Verification script for Twitter automation setup
# Run this before testing to ensure everything is configured

echo "🔍 Verifying Twitter Automation Setup..."
echo ""

# Check Node.js
echo "1. Checking Node.js version..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "   ✅ Node.js $NODE_VERSION installed"
else
    echo "   ❌ Node.js not found - please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

# Check npm
echo "2. Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "   ✅ npm $NPM_VERSION installed"
else
    echo "   ❌ npm not found"
    exit 1
fi

# Check .env file
echo "3. Checking .env file..."
if [ -f ".env" ]; then
    echo "   ✅ .env file exists"

    # Check for critical env vars
    if grep -q "DATABASE_URL=" .env && grep -q "OPENROUTER_API_KEY=" .env; then
        echo "   ✅ Critical environment variables present"
    else
        echo "   ⚠️  Some environment variables may be missing"
    fi
else
    echo "   ❌ .env file not found"
    exit 1
fi

# Check insert-cookies.sql
echo "4. Checking insert-cookies.sql..."
if [ -f "insert-cookies.sql" ]; then
    echo "   ✅ insert-cookies.sql exists"
else
    echo "   ❌ insert-cookies.sql not found"
    exit 1
fi

# Check node_modules
echo "5. Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules directory exists"
else
    echo "   ⚠️  node_modules not found - run 'npm install' first"
fi

# Check psql (optional)
echo "6. Checking PostgreSQL client (optional)..."
if command -v psql &> /dev/null; then
    PSQL_VERSION=$(psql --version | head -n 1)
    echo "   ✅ $PSQL_VERSION installed"
else
    echo "   ⚠️  psql not found - you'll need to insert cookies via another PostgreSQL client"
fi

echo ""
echo "📋 Next Steps:"
echo "   1. Run: npm install"
echo "   2. Insert cookies into database using insert-cookies.sql"
echo "   3. Run: npm run dev"
echo "   4. Test using the curl commands in TESTING-INSTRUCTIONS.md"
echo ""
echo "For detailed instructions, see: TESTING-INSTRUCTIONS.md"
