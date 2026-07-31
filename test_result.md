#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

## user_problem_statement: "go through application, complete the project and fix the errors"
## backend:
##   - task: "Auth (register/login/google-session/me/logout)"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "19/19 pytest tests pass against local MariaDB (port 8001; port 8000 occupied by unrelated webguard app)."
##   - task: "Routes CRUD + seeding"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "4 seeded routes verified via GET /routes and GET /routes/{id}."
##   - task: "Reports, live vehicles, ETA"
##     implemented: true
##     working: true
##     file: "backend/server.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Added user_id filter to GET /reports for profile screen. Karma increment + ETA confidence verified."
##   - task: "Dependency setup"
##     implemented: true
##     working: true
##     file: "backend/requirements.txt"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "requirements.txt was stale (MongoDB-era). Replaced with packages server.py actually needs (sqlalchemy, asyncmy, greenlet, httpx). venv created at backend/.venv (Python 3.12)."
## frontend:
##   - task: "Build/type/lint verification"
##     implemented: true
##     working: true
##     file: "frontend"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "tsc --noEmit clean, expo lint clean, expo export bundles for both iOS and web."
##   - task: "report.tsx route refetch loop"
##     implemented: true
##     working: true
##     file: "frontend/app/(tabs)/report.tsx"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "useEffect deps changed from [routeId] to [] so tapping a route pill no longer re-fetches all routes."
##   - task: "profile.tsx unscoped reports fetch"
##     implemented: true
##     working: true
##     file: "frontend/app/(tabs)/profile.tsx"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Now uses server-side user_id filter instead of downloading 2 weeks of reports and filtering client-side."
##   - task: "drive.tsx pull-to-refresh"
##     implemented: true
##     working: true
##     file: "frontend/app/(tabs)/drive.tsx"
##     stuck_count: 0
##     priority: "low"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Error copy said 'Pull down and try again' but no RefreshControl existed; added it."
##   - task: "API layer env resilience"
##     implemented: true
##     working: true
##     file: "frontend/src/lib/api.ts"
##     stuck_count: 0
##     priority: "medium"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Added fallback default (http://localhost:8000) so app no longer breaks when untracked .env is absent. Added .env.example files for backend and frontend."
##   - task: "Cleanup (junk file, app.json splash, testIds registry)"
##     implemented: true
##     working: true
##     file: "frontend"
##     stuck_count: 0
##     priority: "low"
##     needs_retesting: false
##     status_history:
##       - working: true
##         agent: "main"
##         comment: "Removed committed junk file frontend/=0.24.0, removed dead src/utils/fonts, fixed app.json splash-icon.png -> splash-image.png, synced constants/testIds with real testIDs."
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 1
##   run_ui: false

## test_plan:
##   current_focus:
##     - "None (all tasks passing)"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"

## agent_communication:
##   - agent: "main"
##     message: "Backend runs locally (uvicorn, port 8001) with MariaDB. All 19 API tests pass; frontend typecheck, lint, and iOS/web bundles are clean."
