import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

const ARB_FILE_PATH = path.join(
  vscode.workspace.rootPath!,
  'lib/src/l10n/arb/app_en.arb'
);

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    'extension.modifyArb',
    () => {
      vscode.window
        .showInputBox({ prompt: 'Enter the variable name' })
        .then((variableName) => {
          vscode.window
            .showInputBox({ prompt: 'Enter the English translation' })
            .then((translation) => {
              if (variableName && translation) {
                const key = generateKey(variableName);
                modifyArbFile(key, translation);
                modifyDartFile(key);
                runFlutterGenL10n();
              } else {
                vscode.window.showErrorMessage(
                  'Both variable name and translation must be provided!'
                );
              }
            });
        });
    }
  );

  context.subscriptions.push(disposable);
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
  fs.readFile(ARB_FILE_PATH, 'utf8', (err, data) => {
    if (err) {
      vscode.window.showErrorMessage('Failed to read ARB file');
      return;
    }

    let arbContent = JSON.parse(data);
    arbContent[key] = translation;

    fs.writeFile(
      ARB_FILE_PATH,
      JSON.stringify(arbContent, null, 2),
      'utf8',
      (err) => {
        if (err) {
          vscode.window.showErrorMessage('Failed to write to ARB file');
        } else {
          vscode.window.showInformationMessage(
            'Successfully updated ARB file!'
          );
        }
      }
    );
  });
}

function modifyDartFile(key: string) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const document = editor.document;
    const selection = editor.selection;

    const str = `context.l10n.${key}`;

    editor.edit((editBuilder) => {
      editBuilder.insert(selection.start, str);
    });
  }
}

function runFlutterGenL10n() {
  cp.exec(
    'flutter gen-l10n',
    { cwd: vscode.workspace.rootPath },
    (error, stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage('Failed to run flutter gen-l10n');
        console.log(`error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.log(`stderr: ${stderr}`);
        return;
      }
      vscode.window.showInformationMessage(
        'Successfully run flutter gen-l10n!'
      );
      console.log(`stdout: ${stdout}`);
    }
  );
}

function toSnakeCase(str: string) {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(str: string) {
  return str.toLowerCase().replace(/_([a-z])/g, function (match) {
    return match[1].toUpperCase();
  });
}
