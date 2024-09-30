import * as vscode from 'vscode';

export class TranslatableStringTreeviewProvider implements vscode.TreeDataProvider<TranslatableStringMatch> {
    private _onDidChangeTreeData: vscode.EventEmitter<TranslatableStringMatch | undefined> = new vscode.EventEmitter<TranslatableStringMatch | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TranslatableStringMatch | undefined> = this._onDidChangeTreeData.event;

    private matches: TranslatableStringMatch[] = [];

    constructor() {}

    public refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }

    getFilesInMatches() {
        // only return unique files
        const uniqueFilesInMatches: TranslatableStringMatch[] = [];

        this.matches.forEach((match) => {
            if (!uniqueFilesInMatches.some((file) => file.file === match.file)) {
                uniqueFilesInMatches.push(match);
            }
        });

        return uniqueFilesInMatches.map((match) => new TranslatableStringMatch(
            match.file.split('/').pop()!,
            match.file, 
            '',
            vscode.TreeItemCollapsibleState.Collapsed,
        ));
    }

    getMatchesInFile(file: string): TranslatableStringMatch[] {
        return this.matches.filter(match => match.file === file).map(
            (match) => new TranslatableStringMatch(
                match.matchingText,
                match.file,
                match.matchingText,
                vscode.TreeItemCollapsibleState.None,
            )
        );
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
            // return the list of matches belonging to this element's file
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
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
        
        this.file = file;
        this.matchingText = matchingText;

        // this.command = {
        //     command: 'vscode.open',
        //     title: 'Open File',
        //     arguments: [vscode.Uri.file(file)],
        // };
    }
}
