// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { LinearService } from '../../windsurf-linear/dist/index'; // Import our service
import { WorkflowState } from '@linear/sdk'; // Correct: Import WorkflowState from the SDK

let linearService: LinearService | null = null;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log('"windsurf-linear-extension" is now active!');

	// --- Initialize Linear Service --- 
	try {
        // Read API key from VS Code configuration
        const configuration = vscode.workspace.getConfiguration('windsurf-linear-extension');
        const apiKey = configuration.get<string>('apiKey');

        if (!apiKey) {
            vscode.window.showErrorMessage('Linear API Key not found in settings. Please set "windsurf-linear-extension.apiKey" in your VS Code settings.');
            console.error("Error: Linear API Key not found in VS Code settings.");
            // Optionally, add a button to open settings
            // vscode.window.showErrorMessage('Linear API Key missing. Please configure it in settings.', 'Open Settings').then(selection => {
            //     if (selection === 'Open Settings') {
            //         vscode.commands.executeCommand('workbench.action.openSettings', 'windsurf-linear-extension.apiKey');
            //     }
            // });
            return; // Stop activation if no API key
        }

        // Initialize the service with the API key from settings
        linearService = new LinearService(apiKey);
        console.log("LinearService initialized in extension activation using key from settings.");

	} catch (error: any) {
		vscode.window.showErrorMessage(`Failed to initialize Linear Service: ${error.message}`);
		console.error("Error initializing LinearService:", error);
		return; // Stop activation if service fails
	}

	// --- Register Fetch My Teams Command ---
	let fetchMyTeamsDisposable = vscode.commands.registerCommand('windsurf-linear-extension.fetchMyTeams', async () => {
		if (!linearService) { vscode.window.showErrorMessage('Linear Service not initialized. Check API Key setting.'); return; }
		try {
			const teams = await linearService.fetchTeams();
			if (teams && teams.length > 0) {
				const teamList = teams.map(team => `${team.name} (ID: ${team.id})`).join('\n');
				vscode.window.showInformationMessage(`Your Linear Teams:\n${teamList}`);
			} else {
				vscode.window.showInformationMessage('No Linear teams found or unable to fetch teams.');
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(`Error fetching Linear teams: ${error.message}`);
		}
	});
	context.subscriptions.push(fetchMyTeamsDisposable);

	// --- Register Create Issue Command ---
	let createIssueDisposable = vscode.commands.registerCommand('windsurf-linear-extension.createIssue', async () => {
		if (!linearService) { vscode.window.showErrorMessage('Linear Service not initialized. Check API Key setting.'); return; }
		try {
			// 1. Get Teams for selection
			const teams = await linearService.fetchTeams();
			if (!teams || teams.length === 0) {
				vscode.window.showErrorMessage('No teams found to create issue in.');
				return;
			}
			const teamItems = teams.map(team => ({ label: team.name, description: team.id, id: team.id }));
			const selectedTeam = await vscode.window.showQuickPick(teamItems, { placeHolder: 'Select a team for the new issue' });
			if (!selectedTeam) { return; } // User cancelled
			const teamId = selectedTeam.id;

			// 2. Get States for the selected team
			const states = await linearService.fetchWorkflowStates(teamId);
			if (!states || states.length === 0) { 
				vscode.window.showErrorMessage(`No workflow states found for team ID: ${teamId}`);
				return;
			}

			// 3. Select Workflow State
			const stateItems = states.map((state: WorkflowState) => ({ label: state.name, description: `ID: ${state.id}`, id: state.id }));
			const selectedStateItem = await vscode.window.showQuickPick(stateItems, { placeHolder: 'Select the initial state for the issue' });
			if (!selectedStateItem) { return; } // User cancelled
			const stateId = selectedStateItem.id;

			// 4. Get Issue Title
			const title = await vscode.window.showInputBox({ prompt: 'Enter the issue title', validateInput: text => text ? null : 'Title cannot be empty' });
			if (!title) { return; } // User cancelled or empty input

			// 5. Get Issue Description (Optional)
			const description = await vscode.window.showInputBox({ prompt: 'Enter the issue description (optional)' });

			// Construct payload - Use inline object type matching ICreateIssuePayload
			const payload: { title: string; teamId: string; description?: string; stateId?: string } = {
				title,
				teamId,
			};
			if (description) {
				payload.description = description;
			}
			if (stateId) {
				payload.stateId = stateId;
			}

			// 5. Create Issue
			try {
				vscode.window.showInformationMessage(`Creating issue: ${payload.title}...`);
				const createdIssue = await linearService.createIssue(payload);
				if (createdIssue) {
					vscode.window.showInformationMessage(`Successfully created issue: ${createdIssue.identifier} - ${createdIssue.title} in state '${selectedStateItem.label}'. URL: ${createdIssue.url}`);
				} else {
					vscode.window.showErrorMessage('Failed to create issue. Service returned null.');
				}
			} catch (error: any) {
				vscode.window.showErrorMessage(`Error creating issue: ${error.message}`);
				console.error("Error creating issue:", error);
			}

		} catch (error: any) {
			vscode.window.showErrorMessage(`Error creating Linear issue: ${error.message}`);
		}
	});
	context.subscriptions.push(createIssueDisposable);

	// --- Register Fetch My Issues Command ---
	let fetchMyIssuesDisposable = vscode.commands.registerCommand('windsurf-linear-extension.fetchMyIssues', async () => {
		if (!linearService) { vscode.window.showErrorMessage('Linear Service not initialized. Check API Key setting.'); return; }
		try {
			vscode.window.showInformationMessage('Fetching your assigned Linear issues...');
			const issues = await linearService.fetchMyIssues();

			if (!issues || issues.length === 0) {
				vscode.window.showInformationMessage('No assigned issues found.');
				return;
			}

			// Use Promise.all to resolve state promises concurrently
			const issueItems = await Promise.all(issues.map(async (issue) => {
				const state = await issue.state; // Await the state promise
				const stateName = state ? state.name : 'Unknown State'; // Handle null state
				return {
					label: `${issue.identifier}: ${issue.title}`,
					description: `State: ${stateName} | Priority: ${issue.priority}`, // Use resolved state name
					detail: issue.description?.substring(0, 100) + (issue.description && issue.description.length > 100 ? '...' : ''), // Truncate long descriptions
					id: issue.id
				};
			}));

			const selectedIssue = await vscode.window.showQuickPick(issueItems, { placeHolder: 'Select an issue to view details or copy URL' });

			if (selectedIssue) {
				const issueId = selectedIssue.id;
				const issue = issues.find(issue => issue.id === issueId);
				if (issue) {
					const issueDetails = `**Issue ${issue.identifier} - ${issue.title}**\n\n` +
						`**Description:**\n${issue.description}\n\n` +
						`**State:** ${selectedIssue.description}\n` +
						`**Priority:** ${issue.priority}\n` +
						`**URL:** ${issue.url}`;
					vscode.window.showInformationMessage(issueDetails);
				}
			}

		} catch (error: any) {
			vscode.window.showErrorMessage(`Error fetching your issues: ${error.message}`);
		}
	});
	context.subscriptions.push(fetchMyIssuesDisposable);

	// --- Register Update Issue Command ---
	let updateIssueDisposable = vscode.commands.registerCommand('windsurf-linear-extension.updateIssue', async () => {
		if (!linearService) { vscode.window.showErrorMessage('Linear Service not initialized. Check API Key setting.'); return; }

		try {
			// 1. Get Issue ID
			const issueId = await vscode.window.showInputBox({ prompt: 'Enter the ID (e.g., PDB-123) of the issue to update' });
			if (!issueId) { return; } // User cancelled

			// --- Prompt for updates ---
			const newTitle = await vscode.window.showInputBox({ prompt: `Enter new title for ${issueId} (leave blank to keep current)` });
			const newDescription = await vscode.window.showInputBox({ prompt: `Enter new description for ${issueId} (leave blank to keep current)` });

			// Enhancement: Allow changing state
			let newStateId: string | undefined;
			const changeStateChoice = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Do you want to change the issue state?' });

			if (changeStateChoice === 'Yes') {
				// Fetch the issue to get its current team ID
				const currentIssue = await linearService.fetchIssueById(issueId);
				if (!currentIssue || !currentIssue.team) {
					vscode.window.showErrorMessage(`Could not fetch current issue details or team ID for ${issueId}. Cannot change state.`);
				} else {
					// Await the team promise to get the actual team object
					const team = await currentIssue.team; 
					if (!team) {
						vscode.window.showErrorMessage(`Could not resolve team details for issue ${issueId}.`);
						return; // Or handle differently
					}
					const teamId = team.id; // Now access id on the resolved team object
					const states = await linearService.fetchWorkflowStates(teamId);
					// Remove .nodes access
					if (!states || states.length === 0) { 
						vscode.window.showErrorMessage(`No workflow states found for team ID: ${teamId}`);
					} else {
						// Remove .nodes access, add WorkflowState type
						const stateItems = states.map((state: WorkflowState) => ({ label: state.name, description: `ID: ${state.id}`, id: state.id }));
						const selectedStateItem = await vscode.window.showQuickPick(stateItems, { placeHolder: 'Select the new state for the issue' });
						if (selectedStateItem) {
							newStateId = selectedStateItem.id;
						}
					}
				}
			}

			// Construct payload - Use inline object type matching IUpdateIssuePayload
			const payload: { title?: string; description?: string; stateId?: string } = {}; // Start with empty object
			let updatesMade = false;

			if (newTitle !== undefined && newTitle !== '') {
				payload.title = newTitle;
				updatesMade = true;
			}
			if (newDescription !== undefined && newDescription !== '') {
				payload.description = newDescription; // Assuming description can be updated
				updatesMade = true;
			}
			if (newStateId) { // Add the new state ID if selected
				payload.stateId = newStateId;
				updatesMade = true;
			}

			if (!updatesMade) {
				vscode.window.showInformationMessage('No changes specified for update.');
				return;
			}

			try {
				vscode.window.showInformationMessage(`Updating issue ${issueId}...`);
				const updatedIssue = await linearService.updateIssue(issueId, payload);
				if (updatedIssue) {
					vscode.window.showInformationMessage(`Successfully updated issue: ${updatedIssue.identifier}`);
				} else {
					vscode.window.showErrorMessage('Failed to update issue. Service returned null.');
				}
			} catch (error: any) {
				vscode.window.showErrorMessage(`Error updating issue: ${error.message}`);
				console.error("Error updating issue:", error);
			}

		} catch (error: any) {
			vscode.window.showErrorMessage(`Error updating Linear issue: ${error.message}`);
		}
	});
	context.subscriptions.push(updateIssueDisposable);

	// --- Register Archive Issue Command ---
	let archiveIssueDisposable = vscode.commands.registerCommand('windsurf-linear-extension.archiveIssue', async () => {
		if (!linearService) { vscode.window.showErrorMessage('Linear Service not initialized. Check API Key setting.'); return; }

		try {
			// 1. Get Issue ID
			const issueId = await vscode.window.showInputBox({ prompt: 'Enter the ID (e.g., PDB-123) of the issue to archive' });
			if (!issueId) { return; } // User cancelled

			// 2. Archive Issue
			const success = await linearService.archiveIssue(issueId);
			if (success) {
				vscode.window.showInformationMessage(`Successfully archived issue ${issueId}.`);
			} else {
				vscode.window.showErrorMessage(`Failed to archive issue ${issueId}.`);
			}

		} catch (error: any) {
			vscode.window.showErrorMessage(`Error archiving Linear issue: ${error.message}`);
		}
	});
	context.subscriptions.push(archiveIssueDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
