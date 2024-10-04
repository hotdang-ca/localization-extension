import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { TranslatableStringMatch, TranslatableStringTreeviewProvider } from './treeviewProvider';

/**
 * The path to the arb file in the workspace
 */
let pathToArbFile: string | undefined;

/**
 * The token used to identify translatable strings in the editor
 */
const translatableToken = '.translatable';

/**
 * The treeview
 */
let treeviewProvider: TranslatableStringTreeviewProvider;

/**
 * The prefix used for replacing the key in the editor.
 * 
 * This could be a preference in the future. For now, it's hardcoded
 * to the l10n instance in the LocalizationProvider class.
 * 
 */
const translationPrefix = 'LocalizationProvider.instance.l10n';

/**
 * Main Entrypoint for the extension
 * @param context - the vscode extension context
 */
export function activate(context: vscode.ExtensionContext) {    

  // Create the treeview
  treeviewProvider = new TranslatableStringTreeviewProvider();

  vscode.window.registerTreeDataProvider('translatableMatches', treeviewProvider);
  
  /**
   * Register the command to interactively request a variable name and translation
   */ 

  // Register the command to initialize the arb path for the workspace
  const initializeArbPathDisposable = vscode.commands.registerCommand(
    "extension.initializeArbPath", () => initializeArbPathForWorkspaceHandler(context));
  const modifyArbDisposable = vscode.commands.registerCommand(
    "extension.modifyArb", manuallyAddTranslationHandler);
  const addArbDisposable = vscode.commands.registerCommand(
    "extension.addToArb", addSelectionToArbHandler);
  const genL10nDisposable = vscode.commands.registerCommand(
    "extension.genL10n", runFlutterGenL10n);
  const addAllToArbDisposable = vscode.commands.registerCommand(
    "extension.addAllToArb", addAllToArbHandler);
  const scanWorkspaceForMatchesDisposable = vscode.commands.registerCommand(
    "extension.scanWorkspaceForMatches", scanDirectoryForRegexMatchesHandler);
  const refresh = vscode.commands.registerCommand(
    "extension.refreshEntry", () => treeviewProvider.refresh());

  context.subscriptions.push(initializeArbPathDisposable);
  context.subscriptions.push(modifyArbDisposable);
  context.subscriptions.push(addArbDisposable);
  context.subscriptions.push(genL10nDisposable);
  context.subscriptions.push(addAllToArbDisposable);

  context.subscriptions.push(scanWorkspaceForMatchesDisposable);
  context.subscriptions.push(refresh);
}

/**
 * Handler for the initializeArbPathForWorkspace command.
 * 
 * Initializes the path to the arb file in the workspace.
 * 
 * @param context - the vscode extension context
 */
async function initializeArbPathForWorkspaceHandler(context: vscode.ExtensionContext) {
  initializeArbPathForWorkspace(context).then((arbPath) => {
    if (!arbPath) {
      return;
    }

    // TODO: determine if it is a usable, valid arb file?
    pathToArbFile = arbPath;
    // show a message that we are using the arb file
    vscode.window.showInformationMessage(`Using ARB file: ${pathToArbFile}`);
  });
}

/**
 * Handler for the scanWorkspaceForMatches command.
 * 
 * Scans the workspace for translatable strings, and displays them in the treeview.
 */
async function scanDirectoryForRegexMatchesHandler() {
    const regex = new RegExp(/(["'].*["'])\n?\s*\.translatable/gm);
    const matches: TranslatableStringMatch[] = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        // get subdirectories of this workspace folder
        const subdirectories = await fs.promises.readdir(folder.uri.fsPath);
        
        for (const subdirectory of subdirectories) {
          // is it a file? skip
          const stat = await fs.promises.stat(path.join(folder.uri.fsPath, subdirectory));
          if (!stat.isDirectory()) {
            continue;
          }

          const fullPath = path.join(folder.uri.fsPath, subdirectory);
          // message that we are scanning a folder
          // vscode.window.showInformationMessage(`Scanning folder: ${fullPath}`);
          await scanDirectoryForRegexMatches(fullPath, regex, matches);
          // message that we are done scanning
          // vscode.window.showInformationMessage('Done scanning for translatable strings');
        }

        treeviewProvider.setMatches(matches);
      }
    } else {
      vscode.window.showErrorMessage('No workspace folders found');
    }
}

/**
 * Handler for the modifyArb command.
 * 
 * Prompts for a key, and a string value, and inserts them into the arb file.
 */
async function manuallyAddTranslationHandler(
  _: vscode.ExtensionContext,
) {
  const variableName = await vscode.window.showInputBox({ prompt: 'Enter the variable name' });
  const translatedPhrase = await vscode.window.showInputBox({ prompt: 'Enter the Base (English) translation' });

  // if nul or empty, show error
  if (!variableName || !translatedPhrase) {
    vscode.window.showErrorMessage('Both variable name and translation must be provided!');
    return;
  }

  const key = generateKey(variableName);

  modifyArbFile(key, translatedPhrase);
  runFlutterGenL10n();
}

/**
 * Handler for the addSelectionToArb command.
 * 
 * Adds the selected string to the arb file, and replaces the selection with the key.
 */
async function addStringToArb(str: string): Promise<string> {
  str = str.replace(/['"]/g, '');

  // does rhe selection contain a dart variable?
  // if so, use a different handler for this.
  if (str.includes('$')) {
    // handle creating a key for a string with variables
    // handleVariableString(str);
    // return;
    throw new Error('Strings with variables are not yet supported');
  }

  // We're a simple string with no variables.
  // generate one for us.
  let keyName = generateKeyFromString(str);

  // const keyName = await vscode.window.showInputBox({ 
  //   prompt: 'Enter the key name',
  //   title: 'key name',
  // });
  
  // if (!keyName || keyName === '') {
  //   vscode.window.showErrorMessage('You need to specify a');
  //   throw new Error('You need to specify a key name');
  // }

  const arbContent = await getArbContentFromWorkspace();
  
  // ensure we don't have this key already
  if (arbContent[keyName]) {
    return keyName;

    // show a dialog requesting a new name; repeat until we get a unique name
    // let newName: string | undefined = '';

    // while (true) {
    //   newName = await vscode.window.showInputBox({
    //     prompt: `Key ${keyName} already exists. Enter a new key name`,
    //     title: 'key name',
    //   });

    //   if (!newName || newName === '') {
    //     vscode.window.showErrorMessage('You need to specify a key name');
    //     throw new Error('You need to specify a key name');
    //   }

    //   if (!arbContent[newName]) {
    //     keyName = newName;
    //     break;
    //   }
    // }
  }

  // ensure we don't have this phrase already
  for (const key in arbContent) {
    if (key.startsWith("@")) {
      // it's a parameters key, skip it
      continue;
    }
    
    let kv: string = arbContent[key];
    
    try {
      if (kv.toLowerCase() !== str.toLowerCase()) {
        continue;
      }
    } catch (_) {
      // show user message
      vscode.window.showErrorMessage(`Error comparing strings: ${kv}, ${str}`);
      continue;
    }

    vscode.window.showInformationMessage(`String already exists with key: ${key}`);
    // modifyDartFile(key);
    return key;
  }

  // create new key and string value to arb file
  arbContent[keyName] = str;
  
  // replace selection with the key we just created
  // editor.edit((editBuilder) => {
  //   editBuilder.replace(selection, `context.l10n.${keyName}`);
  // }).then(() => {
  //   insertImports(editor);
  // });

  modifyArbFile(keyName, str);
  return keyName;
}

/**
 * Handler for the addSelectionToArb command. 
 * 
 * Adds the selected string to the arb file, and replaces the selection with the key.
 *
 */
async function addSelectionToArbHandler(
  _: vscode.ExtensionContext,
  andReplaceSelectionWithKey: boolean = true,
  withSelection: vscode.Selection | undefined = undefined
) {
  
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  
  if (!withSelection) {
    // Get text selection, if one wasn't provided
    withSelection = editor.selection;
    // if the selection doesn't start and end with ' or ",
    // but they are adjacent to the selection, modify the
    // selection to include them
    let start = withSelection.start;
    let end = withSelection.end;
  
    if (start.character > 0 && editor.document.getText(new vscode.Range(start.translate(0, -1), start)) === '"' || editor.document.getText(new vscode.Range(start.translate(0, -1), start)) === "'") {
      start = start.translate(0, -1);
    }
    if (end.character < editor.document.lineAt(end.line).range.end.character && editor.document.getText(new vscode.Range(end, end.translate(0, 1))) === '"' || editor.document.getText(new vscode.Range(end, end.translate(0, 1))) === "'") {
      end = end.translate(0, 1);
    }
    withSelection = new vscode.Selection(start, end);
  }
  
  // this now has a hardcoded string enclosed in quotes, 
  // eg. "Hello, World!"
  let text = editor.document.getText(withSelection);
  if (text.includes('$')) {
    // handle creating a key for a string with variables
    handleVariableString(text, withSelection, editor);
    return;
  }
  
  text = text.replace(translatableToken, '').replace(/['"]/g, '').trim();
  const key = await addStringToArb(text);

  if (andReplaceSelectionWithKey) {
    replaceSelectionWithKey(key, withSelection);
  }

  runFlutterGenL10n();
}

/**
 * Handler for the addAllToArb command.
 * 
 * Adds all strings in the active editor to the arb file.
 */
function addAllToArbHandler(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  
  const document = editor.document;
  const matches: string[] = [];
  const regex = /(["'].*["'])\n?\s*\.translatable/gm;
  const documentContents = document.getText();
  const regexMatches = documentContents.match(new RegExp(regex, 'gm'));
  if (regexMatches) {
    matches.push(...regexMatches);
  }
  
  // if we have no matches, show an error and exit
  if (matches.length === 0) {
    vscode.window.showErrorMessage('No strings found to add.\n\nDid you forget to add the .translatable token?');
    return;
  }

  // we have all the strings to add. display to the user to select which to add
  const cleanedStrings = matches.map((key) => key.slice(1, key.indexOf(translatableToken) - 1));
  vscode.window.showQuickPick(cleanedStrings, {
    canPickMany: true,
    placeHolder: 'Select translatable strings to add to arb file',
  }).then(async (selectedStrings) => {
    if (!selectedStrings) {
      // show an error that you need to select a string
      vscode.window.showErrorMessage('You need to select a string to add');
      return;
    }

    for (const selectedString of selectedStrings) {
      const matchToReplace = matches.find((match) => match.includes(selectedString));
      if (!matchToReplace) {
        // show an error that the string was not found
        vscode.window.showErrorMessage(`String not found: ${selectedString}`);
        continue;
      }

      // for each, run it as though it were a selection
      // and add it to the arb file.
      
      // first, modify the editor selection to
      // where this instance of the string is
      let range: vscode.Range | undefined;

      const startOfSelectedString = documentContents.indexOf(matchToReplace);
      const endOfSelectedString = startOfSelectedString + matchToReplace.length;      
      
      range = new vscode.Range(
        // need to find the start, and end, which may span across multiple lines. .translatable may be on its own line.
        new vscode.Position(document.positionAt(startOfSelectedString).line, document.positionAt(startOfSelectedString).character),
        new vscode.Position(document.positionAt(endOfSelectedString).line, document.positionAt(endOfSelectedString).character),
      );

      if (!range) { 
        // show we are skipping
        vscode.window.showErrorMessage(`Failed to find range for string: ${selectedString}`);
        continue;
      }

      // then, select the string
      editor.selection = new vscode.Selection(range.start, range.end);

      // scroll to the selection
      editor.revealRange(range);

      await addSelectionToArbHandler(context, true, editor.selection);

      // and then wait a bit before moving on
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });
}

/**
 * Generates a key based on the string value
 * 
 * @param stringValue the string value to generate a key for
 * @returns a key based on the string value
 *   
 * @example
 * generateKeyFromString('Hello, World!') => 'helloWorld'
 */
function generateKeyFromString(stringValue: string): string {
  // remove " or ' from the string
  stringValue.replace(/['"]/g, '');

  // camelCase the string, at every space, and remove non-alphanumeric characters
  let almostCamelCase = stringValue
    .split(' ')
    .map((word) => word.replace(/[^a-zA-Z]/g, ''))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  
  // make first letter lowercase
  return almostCamelCase
    .charAt(0)
    .toLowerCase() + almostCamelCase.slice(1);
}

/**
 * Generates a key based on the variable name and the filename of the active editor
 * 
 * @param variableName the variable name to generate a key for
 * @returns a key based on the variable name and the filename
 * 
 * @example
 * generateKey('helloWorld') => 'fileName_helloWorld'
 */
function generateKey(variableName: string) {
  // Get filename from active editor
  let fileName: string | undefined;
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    fileName = path.basename(
      activeEditor.document.fileName,
      path.extname(activeEditor.document.fileName)
    );
  }

  // Convert variableName and fileName to snake case
  let snakeCaseVariableName = toSnakeCase(variableName);
  let snakeCaseFileName = fileName ? toSnakeCase(fileName) : '';

  // Generate key based on filename and variable name
  return toCamelCase(`${snakeCaseFileName}_${snakeCaseVariableName}`);
}

/**
 * Modifies the arb file with the specified key and translation
 * 
 * @param key the key to insert into the arb file
 * @param translation the translation to insert into the arb file
 * 
 */
function modifyArbFile(key: string, translation: string) {
  if (!pathToArbFile) {
    return;
  }

  let arbRawData: string = fs.readFileSync(pathToArbFile, 'utf8');
  if (!arbRawData) {
    vscode.window.showErrorMessage('Failed to read ARB file');
    return;
  }

  let arbContent: any;
  try {
    arbContent = JSON.parse(arbRawData);
  } catch (e) {
    vscode.window.showErrorMessage('Failed to parse ARB file');
    return;
  }

  arbContent[key] = translation;

  try {
    const arbContentString = JSON.stringify(arbContent, null, 2);
    fs.writeFileSync(pathToArbFile, arbContentString, 'utf8');
    vscode.window.showInformationMessage(
      'Successfully updated ARB file!'
    );
  } catch (e) {
    vscode.window.showErrorMessage('Failed to write to ARB file');
    return;
  }
}

/**
 * Replaces the current selection in the current editor with the specified key
 * 
 * @param key A key to insert into the dart file
 */
function modifyDartFile(key: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const replacementString = `${translationPrefix}.${key}`;

  editor.edit((editBuilder) => {
    editBuilder.replace(selection, replacementString);
  }).then(() => {
    insertImports(editor);
  });
}

/**
 * Executes the flutter gen-l10n command in the workspace folder.
 */
function runFlutterGenL10n() {
  const workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath;
  cp.exec(
    'melos run l10n',
    { cwd: workspacePath },
    (err, _, stderr) => {
      if (err) {
        vscode.window.showErrorMessage('Failed to run flutter gen-l10n');
        console.log(`error: ${err.message}`);
        return;
      }

      if (stderr) {
        console.log(`stderr: ${stderr}`);
        return;
      }

      vscode.window.showInformationMessage(
        'Successfully ran flutter gen-l10n!'
      );
    }
  );
}

/**
 * Simple helper function to convert a string to snake_case
 * @param str the original string
 * @returns a snake_case version of the string, split at capital letters
 */
function toSnakeCase(str: string) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Simple helper function to convert a snake_case string to camelCase
 * 
 * @param str the original snake_case string
 * @returns a camelCase version of the string, with underscores removed
 */
function toCamelCase(str: string) {
  return str
    .toLowerCase()
    .replace(/_([a-z])/g, (match) => match[1].toUpperCase());
}

/**
 * Handles the creation of a key for a string with dart variables in it.
 * 
 * This method will insert the key into the arb file, add the placeholders to the arb file,
 * and replace the selection with the key.
 * 
 * @param text - the original text of the selection
 * @param selection - a reference to the selection, so we can replace it in the editor
 * @param editor - a reference to the editor, so we can replace the selection
 * @returns 
 */
async function handleVariableString(
  text: string,
  selection: vscode.Selection,
  editor: vscode.TextEditor,
) {
  // get the variables in the string
  // https://regex101.com/r/Kb2egE/1
  const variableRegex = /\${?([a-zA-Z_$][a-zA-Z_$0-9\[\]\.\?\!\'\(\)]+)/g;

  let variables: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = variableRegex.exec(text))) {
    variables.push(match[1]);
  }

  if (!variables || variables.length === 0) {
    vscode.window.showErrorMessage('No variables found in the string');
    return;
  }

  // request a keyName

  const keyName = generateKeyFromString(text);

  // const keyName: string | undefined = await vscode.window.showInputBox({
  //   prompt: 'Enter the key name',
  //   title: 'key name',
  // });

  // if (!keyName) {
  //   vscode.window.showErrorMessage('You need to specify a key name');
  //   return;
  // }

  // get the arb file
  const arbContent = await getArbContentFromWorkspace();
  
  // ensure we don't have this key already
  if (arbContent[keyName]) {
    vscode.window.showErrorMessage('Key already exists');
    replaceSelectionWithKey(keyName, selection);
    return;
  }

  // ensure we don't have this same string value already
  for (const key in arbContent) {
    let keyAtIndex = arbContent[key];

    if (keyAtIndex.toLowerCase() !== text.toLowerCase()) {
      continue;
    }

    vscode.window.showInformationMessage(`String already exists with key: ${key}`);
    replaceSelectionWithKey(key, selection); // TODO: what about the parameters??
    return;
  }

  // create new key and string value to arb file
  // Text needs its variables replaced with the variable key names, encapsulated with {}
  // e.g. 'Hello $name' => 'Hello {name}'
  variables.forEach((v) => {
    const cleanVariableName = v.replace(/[^a-zA-Z]/g, '');
    text = text
      .replace(v, `${cleanVariableName}`)
      .replace(`\${${cleanVariableName}}`, `{${cleanVariableName}}`);
  });

  arbContent[keyName] = text.replace(/['"]/g, '');

  // replace selection with the key we just created, and parameters
  let replacementString = `${translationPrefix}.${keyName}`;
  replacementString += '(';
  variables.forEach((variable) => {
    replacementString += `${variable}, `;
  });
  replacementString = replacementString.slice(0, -2);
  replacementString += ')';

  // replace the selection with the key and parameters
  editor.edit((editBuilder) => {
    editBuilder.replace(selection, replacementString);
  }).then(() => {
    insertImports(editor);
  });

  // add the placeholders for the arb file
  const placeholders: any = {};
  variables.forEach((v) => {
    const cleanVariableName = v.replace(/[^a-zA-Z]/g, '');
    placeholders[cleanVariableName] = {}; // this is arb syntax. /shrug
  });

  // load these placeholders into the arb file, 
  // under a key that is the keyName with a @ prefix
  arbContent[`@${keyName}`] = {
    placeholders: placeholders
  };

  const arbDataString = JSON.stringify(arbContent, null, 2);
  fs.writeFileSync(pathToArbFile!, arbDataString, 'utf8');
  vscode.window.showInformationMessage(
    'Successfully updated ARB file!'
  );

  runFlutterGenL10n();
}

// /**
//  * Retrieves the path to the arb file in the workspace folder.
//  * @returns the path to the arb file, or undefined if no workspace folder is found
//  */
// function getArbPath(): string | undefined {
//   if (!vscode.workspace.workspaceFolders) {
//     vscode.window.showErrorMessage('No workspace folder found!');
//     return;
//   }
//   context.
//   // retreive from momento
//   // if not found, show a dialog to select the arb file

//   return path.join(
//     vscode.workspace.workspaceFolders![0].uri.path,
//     'lib/src/l10n/arb/app_en.arb', // TODO: possibly search the workspace for the arb file, or let the user specify it
//   );
// };

/**
 * Inserts required imports into the editor for the l10n package
 * 
 * @param editor reference to the vscode editor instance to insert the import into
 */
function insertImports(editor: vscode.TextEditor) {
  // search for the l10n import, and if not, 
  // add to the top of the file

  const importLine = `import 'package:vsbl_l10n/lib.dart';`;
  const document = editor.document;
  let foundImport = false;

  let lastImportBlockLine = 0;
  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);

    if (line.text.includes('import')) {
      lastImportBlockLine = i;
    }

    if (!foundImport && line.text.includes(importLine)) {
      foundImport = true;
    }
  }

  if (!foundImport) {
    editor.edit((editBuilder) => {
      editBuilder.insert(new vscode.Position(lastImportBlockLine + 1, 0), `${importLine}\n`);
    });
  }
}

/**
 * Retrieves the content of the arb file in the workspace folder.
 * @returns the content of the arb file as an object
 */
async function getArbContentFromWorkspace(): Promise<any> {
  if (!pathToArbFile) {
    let arbPath: string | undefined | null = await requestArbPathWithDialog();
    // vscode.window.showErrorMessage('No ARB file specified for the workspace');
    if (!arbPath && !pathToArbFile) {
      return;
    }

    // save the arb path to the workspace state
    vscode.workspace.getConfiguration('vsbl').update('arbPath', arbPath);

    pathToArbFile ??= arbPath;
  }

  const arbData = fs.readFileSync(pathToArbFile!, 'utf8');
  if (!arbData) {
    vscode.window.showErrorMessage('Failed to read ARB file');
    throw new Error('Failed to read ARB file');
  }

  return JSON.parse(arbData);
}

/**
 * Replaces the current selection in the editor with the specified key
 * 
 * @param key the key to insert into the dart file
 * @param selection the selection to replace with the key
 */
function replaceSelectionWithKey(
  key: string,
  selection: vscode.Selection,
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  editor.edit((editBuilder) => {
    editBuilder.replace(selection, `${translationPrefix}.${key}`);
  }).then(() => {
    insertImports(editor);
  });
}

/**
 * Recursively scans a directory for translatable strings
 * 
 * @param directory the directory to scan
 * @param regex the rexex to use for the search
 * @param matches the array to store the matches in; passed in by reference
 * 
 * @returns a promise that resolves when the scan is complete
 */
async function scanDirectoryForRegexMatches(directory: string, regex: RegExp, matches: TranslatableStringMatch[]) {
  const files = await fs.promises.readdir(directory);

  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = await fs.promises.stat(fullPath);

    if (stat.isDirectory()) {
      await scanDirectoryForRegexMatches(fullPath, regex, matches);
    } else {
      if (!file.endsWith('.dart')) {
        continue;
      }

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content))) { // while we have a match
        const line = content.substr(0, match.index).split('\n').length;
        const column = match.index - content.lastIndexOf('\n', match.index) - 1;

        matches.push(
          new TranslatableStringMatch(
            file.split('/').pop()!,
            fullPath,
            match[0],
            line,
            column,
            '',
            vscode.TreeItemCollapsibleState.None,
        ));
      }
    }
  }
}

/**
 * Sets the path to the arb file in the workspace for the extension
 * 
 * @param context a VSCode ExtensionContext
 * @returns the path to the arb file, or undefined if not set
 * 
 */
async function initializeArbPathForWorkspace(context: vscode.ExtensionContext): Promise<string | undefined> {
  let arbPath: string | undefined | null = context.workspaceState.get('arbPath') as string;
  
  // arbPath = null;

  if (arbPath) {
    return arbPath;
  } else {
    const arbPath = await requestArbPathWithDialog();
    context.workspaceState.update('arbPath', arbPath);
    return arbPath;
  }
}

/**
 * Requests the user to select an arb file
 * 
 * @returns the path to the selected arb file
 */
async function requestArbPathWithDialog(): Promise<string | undefined> {
  const setAction = 'Select ARB file';
  const ignoreAction = 'Nope';
  const selectedAction = await vscode.window.showErrorMessage(
    'No ARB file specified for the workspace. Did you want to set it?',
    setAction,
    ignoreAction,
  );
  
  if (selectedAction === ignoreAction) {
    vscode.window.showErrorMessage('No ARB file was specified. Some features may not work');
    return;
  } else if (selectedAction === undefined) {
    vscode.window.showErrorMessage('No ARB file was specified. Some features may not work');
    return;
  } else {
    // selectedAction === setAction
    // show a file dialog to select the arb file
    await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Base-Language ARB File': ['arb'],
      },
    }).then((selectedArbPath) => {
      if (!selectedArbPath) {
        vscode.window.showErrorMessage('No ARB file was specified. Some features may not work.');
        return;
      }

      let arbPath = selectedArbPath[0].fsPath;
      pathToArbFile = arbPath;
      Promise.resolve(arbPath);
    });
  }
}