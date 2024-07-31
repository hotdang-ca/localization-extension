import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

/**
 * Main Entrypoint for the extension
 * @param context - the vscode extension context
 */
export function activate(context: vscode.ExtensionContext) {
  /**
   * Register the command to interactively request a variable name and translation
   */ 
  let modifyArbDisposable = vscode.commands.registerCommand(
    "extension.modifyArb", manuallyAddTranslationHandler);
  let addArbDisposable = vscode.commands.registerCommand(
    "extension.addToArb", addSelectionToArbHandler);
  let genL10nDisposable = vscode.commands.registerCommand(
    "extension.genL10n", runFlutterGenL10n);
  let addAllToArbDisposable = vscode.commands.registerCommand(
    "extension.addAllToArb", addAllToArbHandler);

  context.subscriptions.push(modifyArbDisposable);
  context.subscriptions.push(addArbDisposable);
  context.subscriptions.push(genL10nDisposable);
  context.subscriptions.push(addAllToArbDisposable);
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
    // show a dialog requesting a new name; repeat until we get a unique name
    let newName: string | undefined = '';

    while (true) {
      newName = await vscode.window.showInputBox({
        prompt: `Key ${keyName} already exists. Enter a new key name`,
        title: 'key name',
      });

      if (!newName || newName === '') {
        vscode.window.showErrorMessage('You need to specify a key name');
        throw new Error('You need to specify a key name');
      }

      if (!arbContent[newName]) {
        keyName = newName;
        break;
      }
    }
  }

  // ensure we don't have this phrase already
  for (const key in arbContent) {
    let keyValue = arbContent[key];
    
    if (keyValue.toLowerCase() !== str.toLowerCase()) {
      continue;
    }

    vscode.window.showErrorMessage(`String already exists with key: ${key}`);
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
) {
  // Get text selection
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  let selection = editor.selection;
  
  // if the selection doesn't start and end with ' or ",
  // but they are adjacent to the selection, modify the
  // selection to include them
  let start = selection.start;
  let end = selection.end;

  if (start.character > 0 && editor.document.getText(new vscode.Range(start.translate(0, -1), start)) === '"' || editor.document.getText(new vscode.Range(start.translate(0, -1), start)) === "'") {
    start = start.translate(0, -1);
  }
  if (end.character < editor.document.lineAt(end.line).range.end.character && editor.document.getText(new vscode.Range(end, end.translate(0, 1))) === '"' || editor.document.getText(new vscode.Range(end, end.translate(0, 1))) === "'") {
    end = end.translate(0, 1);
  }
  selection = new vscode.Selection(start, end);
  
  // this now has a hardcoded string enclosed in quotes, 
  // eg. "Hello, World!"
  let text = editor.document.getText(selection);
  if (text.includes('$')) {
    // handle creating a key for a string with variables
    handleVariableString(text, selection, editor);
    return;
  }

  const key = await addStringToArb(text);

  if (andReplaceSelectionWithKey) {
    replaceSelectionWithKey(key, selection);
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

  const arbPath = getArbPath();
  if (!arbPath) {
    return;
  }

  const arbRawData = fs.readFileSync(arbPath, 'utf8');
  if (!arbRawData) {
    vscode.window.showErrorMessage('Failed to read ARB file');
    return;
  }

  const arbContent = JSON.parse(arbRawData);
  const keys = Object.keys(arbContent);

  const document = editor.document;

  const keysToAdd: string[] = [];

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    let text = line.text;

    // if the line is empty, skip it
    if (text.trim() === '') {
      continue;
    }

    // if the line is a comment, skip it
    if (text.trim().startsWith('//')) {
      continue;
    }

    if (!text.trim().includes('.hardcoded')) {
      continue;
    }

    // interpret this line, marking the ''.hardcoded or "".hardcoded for display
    // in a list of strings to add to the arb file

    // the string wrapping character will be just to the left of the .hardcoded. 
    // Get that, first.
    let wrappingCharacter = text[text.indexOf('.hardcoded') - 1];

    // find the range of the string. It will be found with regex, where
    // we find the wrapping character, followed by any number of characters,
    // followed by the wrapping character again and .hardcoded.
    const regexString = `(\\${wrappingCharacter}.*\\${wrappingCharacter})\\.hardcoded`;
    const regex = new RegExp(regexString);
    const match = text.match(regex);
    
    // add match to the list of strings to add
    if (match) {
      keysToAdd.push(match[1]);
    }
  }

  // we have all the strings to add. display to the user to select which to add
  vscode.window.showQuickPick(keysToAdd, {
    canPickMany: true,
    placeHolder: 'Select strings to add to arb file'
  }).then((selectedStrings) => {
    if (!selectedStrings) {
      // show an error that you need to select a string
      vscode.window.showErrorMessage('You need to select a string to add');
      return;
    }

    selectedStrings.forEach((string) => {
      // for each, run it as though it were a selection
      // and add it to the arb file.
      
      // first, select the matching string in the editor
      let range: vscode.Range | undefined;
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (line.text.includes(string)) {
          range = new vscode.Range(
            new vscode.Position(i, line.text.indexOf(string)),
            new vscode.Position(i, line.text.indexOf(string) + string.length)
          );
          break;
        }
      }

      // then, add the selection to the arb file
      addSelectionToArbHandler(context);
    });
  });
}


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


function modifyArbFile(key: string, translation: string) {
  const arbPath = getArbPath();
  if (!arbPath) {
    return;
  }

  let arbRawData: string = fs.readFileSync(arbPath, 'utf8');
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
    fs.writeFileSync(arbPath, arbContentString, 'utf8');
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
  const replacementString = `context.l10n.${key}`;

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
    'flutter gen-l10n',
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
        'Successfully run flutter gen-l10n!'
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

    vscode.window.showErrorMessage(`String already exists with key: ${key}`);
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
  let replacementString = `context.l10n.${keyName}`;
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

  const arbPath = getArbPath();
  const arbDataString = JSON.stringify(arbContent, null, 2);
  fs.writeFileSync(arbPath!, arbDataString, 'utf8');
  vscode.window.showInformationMessage(
    'Successfully updated ARB file!'
  );

  runFlutterGenL10n();
}

/**
 * Retrieves the path to the arb file in the workspace folder.
 * @returns the path to the arb file, or undefined if no workspace folder is found
 */
function getArbPath(): string | undefined {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder found!');
    return;
  }

  return path.join(
    vscode.workspace.workspaceFolders![0].uri.path,
    'lib/src/l10n/arb/app_en.arb',
  );
};

/**
 * Inserts required imports into the editor for the l10n package
 * 
 * @param editor reference to the vscode editor instance to insert the import into
 */
function insertImports(editor: vscode.TextEditor) {
  // search for the l10n import, and if not, 
  // add the import line import 'package:vsbl/src/l10n/l10n.dart';
  const importLine = `import 'package:vsbl/src/l10n/l10n.dart';`;
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
function getArbContentFromWorkspace(): any {
  const arbPath = getArbPath();
  const arbData = fs.readFileSync(arbPath!, 'utf8');
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
    editBuilder.replace(selection, `context.l10n.${key}`);
  }).then(() => {
    insertImports(editor);
  });
}

