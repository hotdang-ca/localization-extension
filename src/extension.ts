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

  context.subscriptions.push(modifyArbDisposable);
  context.subscriptions.push(addArbDisposable);
  context.subscriptions.push(genL10nDisposable);
}

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
    editBuilder.insert(selection.start, replacementString);
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
  const arbPath = getArbPath();

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
  const keyName: string | undefined = await vscode.window.showInputBox({
    prompt: 'Enter the key name',
    title: 'key name',
  });

  if (!keyName) {
    vscode.window.showErrorMessage('You need to specify a key name');
    return;
  }

  const rawArbData = fs.readFileSync(arbPath!, 'utf8');
  if (!rawArbData) {
    vscode.window.showErrorMessage('Failed to read ARB file');
    return;
  }

  const arbContent = JSON.parse(rawArbData);

  // ensure we don't have this key already
  if (arbContent[keyName]) {
    vscode.window.showErrorMessage('Key already exists');
    // insert the key we found
    editor.edit((editBuilder) => {
      editBuilder.replace(selection, `context.l10n.${keyName}`);
    }).then(() => {
      insertImports(editor);
    });

    return;
  }

  // ensure we don't have this same string value already
  for (const key in arbContent) {
    let keyAtIndex = arbContent[key];

    if (keyAtIndex.toLowerCase() !== text.toLocaleLowerCase()) {
      continue;
    }

    vscode.window.showErrorMessage(`String already exists with key: ${key}`);

    // replace selection with the key we found
    editor.edit((editBuilder) => {
      editBuilder.replace(selection, `context.l10n.${key}`);
    }).then(() => {
      insertImports(editor);
    });
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

  arbContent[keyName] = text;

  // replace selection with the key we just created.
  let replacementString = `context.l10n.${keyName}`;

  replacementString += '(';

  // and add the variables as parameters
  variables.forEach((variable) => {
    replacementString += `${variable}, `;
  });

  // replace last ','
  replacementString = replacementString.slice(0, -2);

  // close the function call
  replacementString += ')';

  // replace the selection with the key and parameters
  editor.edit((editBuilder) => {
    editBuilder.replace(selection, replacementString);
  }).then(() => {
    insertImports(editor);
  });

  // add the placeholders
  const placeholders: any = {};
  variables.forEach((v) => {
    // remove non-alpha characters from the variable name, and make it camelCase
    const cleanVariableName = v.replace(/[^a-zA-Z]/g, '');
    placeholders[cleanVariableName] = {}; // this is arb syntax. /shrug
  });

  // load these placeholders into the arb file, 
  // under a key that is the keyName with a @ prefix
  arbContent[`@${keyName}`] = {
    placeholders: placeholders
  };

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
 * Handler for the modifyArb command.
 * 
 * Prompts for a key, and a string value, and inserts them into the arb file.
 */
async function manuallyAddTranslationHandler(context: vscode.ExtensionContext) {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder found!');
    return;
  }

  const variableName = await vscode.window.showInputBox({ prompt: 'Enter the variable name' });
  const translatedPhrase = await vscode.window.showInputBox({ prompt: 'Enter the Base (English) translation' });

  // if nul or empty, show error
  if (!variableName || !translatedPhrase) {
    vscode.window.showErrorMessage('Both variable name and translation must be provided!');
    return;
  }

  const key = generateKey(variableName);

  modifyArbFile(key, translatedPhrase);
  modifyDartFile(key);
  runFlutterGenL10n();
}

/**
 * Handler for the addSelectionToArb command. 
 * 
 * Adds the selected string to the arb file, and replaces the selection with the key.
 *
 */
async function addSelectionToArbHandler(context: vscode.ExtensionContext) {
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
  
  let text = editor.document.getText(selection);

  // remove leading and trailing quotes from text, though.
  // Not the selection... just the text
  if (text.startsWith('"') || text.startsWith("'")) {
    text = text.slice(1);
  }
  if (text.endsWith('"') || text.endsWith("'")) {
    text = text.slice(0, -1);
  }

  // does rhe selection contain a dart variable?
  // if so, use a different handler for this.
  if (text.includes('$')) {
    // handle creating a key for a string with variables
    handleVariableString(text, selection, editor);
    return;
  }

  // We're a simple string. Handle it as such.
  const keyName = await vscode.window.showInputBox({ 
    prompt: 'Enter the key name',
    title: 'key name',
  });
  
  if (!keyName || keyName === '') {
    vscode.window.showErrorMessage('You need to specify a');
    return;
  }

  const arbData = fs.readFileSync(getArbPath()!, 'utf8');
  if (!arbData) {
    vscode.window.showErrorMessage('Failed to read ARB file');
    return;
  }

  const arbContent = JSON.parse(arbData);
  
  // ensure we don't have this key already
  if (arbContent[keyName]) {
    vscode.window.showErrorMessage('Key already exists');

    // replace selection with the value of this key
    editor.edit((editBuilder) => {
      editBuilder.replace(selection, `context.l10n.${keyName}`);
    }).then(() => {
      insertImports(editor);
    });

    return;
  }

      // ensure we don't have this phrase already
  for (const key in arbContent) {
    let keyString = arbContent[key];
    
    if (keyString.toLowerCase() !== text.toLocaleLowerCase()) {
      continue;
    }

    vscode.window.showErrorMessage(`String already exists with key: ${key}`);
    // replace selection with the key we found
    editor.edit((editBuilder) => {
      editBuilder.replace(selection, `context.l10n.${key}`)
    }).then(() => {
      insertImports(editor);
    });

    break;
  }

  // create new key and string value to arb file
  arbContent[keyName] = text;
  // replace selection with the key we just created
  editor.edit((editBuilder) => {
    editBuilder.replace(selection, `context.l10n.${keyName}`);
  }).then(() => {
    insertImports(editor);
  });

  modifyArbFile(keyName, text);
  modifyDartFile(keyName);
  runFlutterGenL10n();
}

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

