import * as vscode from 'vscode';

export class TranslatableStringTreeviewProvider implements vscode.TreeDataProvider<TranslatableStringMatch> {

    private _onDidChangeTreeData: vscode.EventEmitter<TranslatableStringMatch | undefined | null | void> = new vscode.EventEmitter<TranslatableStringMatch | null | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TranslatableStringMatch | null | undefined | void> = this._onDidChangeTreeData.event;

    private matches: TranslatableStringMatch[] = [];

    constructor() {}
    
    public refresh() {
        this._onDidChangeTreeData.fire();
    }

    getFilesInMatches() {
        // only return unique files
        const uniqueFilesInMatches: TranslatableStringMatch[] = [];

        this.matches.forEach((match) => {
            if (!uniqueFilesInMatches.some((file) => file.file === match.file)) {
                uniqueFilesInMatches.push(match);
            }
        });

        return uniqueFilesInMatches.map((match) => {
            const baseFileName = match.file.split('/').pop()!;
            const workspacePath = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
            const relativePathToFileFolder = match.file.replace(workspacePath, '')
                .split('/')
                .slice(1, -1)
                .join('/');

            const newMatch = new TranslatableStringMatch(
                baseFileName,
                match.file, 
                '',
                0,
                0,
                relativePathToFileFolder,
                vscode.TreeItemCollapsibleState.Collapsed,
            );
            return newMatch;
        });
    }

    getMatchesInFile(file: string): TranslatableStringMatch[] {
        const matchesBelongingToFile = this.matches.filter(match => match.file === file);
        const preparedMatches = [];

        for (const match of matchesBelongingToFile) {
            const translatableStringMatch = new TranslatableStringMatch(
                match.matchingText,
                match.file,
                match.matchingText,
                match.line,
                match.column,
                '',
                vscode.TreeItemCollapsibleState.None,
            );

            // open file and jump to the line where the match is
            translatableStringMatch.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(file).with({ fragment: `${match.line},${match.column}` })],
            };

            preparedMatches.push(translatableStringMatch);
        }

        return preparedMatches;
    }

    public setMatches(matches: TranslatableStringMatch[]) {
        this.matches = matches;
        this.refresh();
    }

    getTreeItem(element: TranslatableStringMatch): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TranslatableStringMatch): Thenable<TranslatableStringMatch[]> {
        if (element) {
            return Promise.resolve(this.getMatchesInFile(element.file));
        }

        return Promise.resolve(this.getFilesInMatches());
    }
}

export class TranslatableStringMatch extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly file: string,
        public readonly matchingText: string,
        public readonly line: number = 0,
        public readonly column: number = 0,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
        
        this.file = file;
        this.matchingText = matchingText;
        this.description = description;

        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [vscode.Uri.file(file)],
        };
    }
}
