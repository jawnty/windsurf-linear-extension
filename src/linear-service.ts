// src/linear-service.ts
import { LinearClient, Issue, Team, LinearDocument, WorkflowState, User, LinearFetch } from '@linear/sdk';
import dotenv from 'dotenv';

// --- Interfaces for Payloads (Optional but recommended) ---
export interface IssueCreatePayload {
  title: string;
  teamId: string;
  description?: string;
  priority?: number; // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
  stateId?: string;
  // Add other optional fields as needed: assigneeId, labelIds, etc.
}

export interface IssueUpdatePayload {
  title?: string;
  description?: string;
  priority?: number;
  stateId?: string;
  assigneeId?: string;
  // Add other optional fields as needed
}

// --- Linear Service Class ---
export class LinearService {
  private client: LinearClient | null = null;

  constructor(apiKey?: string) {
    dotenv.config(); // Load .env variables
    const effectiveApiKey = apiKey || process.env.LINEAR_API_KEY;

    if (!effectiveApiKey) {
      console.error("Error: LINEAR_API_KEY is not defined in environment variables or passed to constructor.");
      // In a real extension, you might handle this differently (e.g., prompt user)
    } else {
      this.client = new LinearClient({ apiKey: effectiveApiKey });
      console.log("Linear client initialized in service.");
    }
  }

  getClient(): LinearClient | null {
      return this.client;
  }

  async connectAndFetchViewer(): Promise<User | null> {
    if (!this.client) {
        console.error("Linear client not initialized.");
        return null;
    }
    console.log("\nConnecting to Linear...");
    try {
      const me = await this.client.viewer;
      console.log(`Successfully connected to Linear as: ${me.name} (${me.email})`);
      return me;
    } catch (error) {
      console.error("Failed to connect to Linear or fetch viewer:", error);
      return null;
    }
  }

  async fetchMyIssues(): Promise<Issue[]> {
     if (!this.client) return [];
    console.log("\nFetching your assigned issues...");
    try {
      const me = await this.client.viewer;
      const issuesResult = await this.client.issues({
        filter: { assignee: { id: { eq: me.id } } },
        orderBy: LinearDocument.PaginationOrderBy.CreatedAt,
        first: 25
      });

      if (issuesResult.nodes.length) {
        console.log(`Found ${issuesResult.nodes.length} issues assigned to you:`);
        for (const issue of issuesResult.nodes) {
          const state = await issue.state;
          console.log(`- ${issue.identifier}: ${issue.title} [${state?.name ?? 'No Status'}]`);
        }
        return issuesResult.nodes;
      } else {
        console.log("No issues found assigned to you matching the criteria.");
        return [];
      }
    } catch (error) {
      console.error("Error fetching issues:", error);
      return [];
    }
  }

  async fetchTeams(): Promise<Team[]> {
     if (!this.client) return [];
    console.log("\nFetching available teams...");
    try {
      const teamsResult = await this.client.teams();
      if (teamsResult.nodes.length) {
        console.log(`Found ${teamsResult.nodes.length} teams:`);
        teamsResult.nodes.forEach(team => {
          console.log(`- ${team.name} (ID: ${team.id}, Key: ${team.key})`);
        });
        return teamsResult.nodes;
      } else {
        console.log("No teams found for this user.");
        return [];
      }
    } catch (error) {
      console.error("Error fetching teams:", error);
      return [];
    }
  }

 async fetchTeamStates(teamId: string): Promise<WorkflowState[]> {
     if (!this.client) return [];
    console.log(`\nFetching states for team ID ${teamId}...`);
    try {
      const statesResult = await this.client.workflowStates({
        filter: { team: { id: { eq: teamId } } }
      });
      if (statesResult.nodes.length) {
        console.log(`Found ${statesResult.nodes.length} states:`);
        statesResult.nodes.forEach(state => {
          console.log(`- ${state.name} (ID: ${state.id}, Type: ${state.type})`);
        });
        return statesResult.nodes;
      } else {
        console.log("No states found for this team.");
        return [];
      }
    } catch (error) {
      console.error(`Error fetching states for team ${teamId}:`, error);
      return [];
    }
  }

  async createIssue(payload: IssueCreatePayload): Promise<Issue | null> {
     if (!this.client) return null;
    console.log(`\nCreating issue "${payload.title}" in team ${payload.teamId}...`);
     if (payload.priority !== undefined) console.log(` - Setting priority: ${payload.priority}`);
     if (payload.stateId) console.log(` - Setting state ID: ${payload.stateId}`);
    try {
      // The SDK's createIssue expects the payload directly
      const result = await this.client.createIssue(payload);

      if (result.success && result.issue) {
        const createdIssue = await result.issue;
        console.log(`Successfully created issue: ${createdIssue.identifier} - ${createdIssue.title} (ID: ${createdIssue.id})`);
        return createdIssue;
      } else {
        console.error("Failed to create issue. API reported failure or returned no issue.", result);
        return null;
      }
    } catch (error) {
      console.error("Error creating issue:", error);
      return null;
    }
  }

  async fetchIssueById(issueId: string): Promise<Issue | null> {
     if (!this.client) return null;
    console.log(`\nFetching issue by ID: ${issueId}...`);
    try {
      // client.issue returns a LinearFetch object, await it to get the Issue
      const issue = await this.client.issue(issueId);
       if (issue) {
           // Check if the issue might be considered 'not found' even if an object is returned
           // (e.g., if fetching a non-existent ID returns an object with null properties)
           // This depends on SDK behavior, often a direct fetch throws if not found.
           // Assuming if `issue` is truthy, it was found.
           console.log(`Found issue: ${issue.identifier} - ${issue.title}`);
           return issue;
       } else {
           // This else block might be unreachable if the SDK throws an error for not found IDs
           console.log(`Issue with ID ${issueId} not found.`);
           return null;
       }
    } catch (error) {
      // Catching errors is important, especially for 'not found' scenarios if the SDK throws
      console.error(`Error fetching issue ${issueId}:`, error);
      return null;
    }
  }

  async updateIssue(issueId: string, payload: IssueUpdatePayload): Promise<Issue | null> {
     if (!this.client) return null;
    console.log(`\nUpdating issue ${issueId}...`);
    try {
       // The SDK's updateIssue method returns { success, issue? }
      const result = await this.client.updateIssue(issueId, payload);

       if (result.success) {
           const issue = await result.issue; // Await the potentially returned issue LinearFetch
           if (issue) {
               console.log(`Successfully updated issue ${issue.identifier}. New title: ${issue.title}`); // Example log
               return issue;
           } else {
               // Should not happen if success is true according to SDK patterns, but handle defensively
                console.warn(`Issue ${issueId} update reported success, but no issue data returned.`);
               return null; // Or fetch manually if needed
           }
       } else {
           console.error(`Failed to update issue ${issueId}. API reported failure.`);
           return null;
       }
    } catch (error) {
      console.error(`Error updating issue ${issueId}:`, error);
      return null;
    }
  }

   // Renamed from deleteIssue
  async archiveIssue(issueId: string): Promise<boolean> {
     if (!this.client) return false;
    console.log(`\nAttempting to archive issue ${issueId}...`);
    try {
      // archiveIssue returns { success }
      const result = await this.client.archiveIssue(issueId);
      if (result.success) {
        console.log(`Successfully archived issue ${issueId}.`);
        return true;
      } else {
        console.error(`Failed to archive issue ${issueId}. API reported failure.`);
        return false;
      }
    } catch (error) {
      console.error(`Error archiving issue ${issueId}:`, error);
      return false;
    }
  }
}
