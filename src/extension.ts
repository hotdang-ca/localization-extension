import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

const getArbPath = (): string | undefined => {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder found!');
    return;
  }

  return path.join(vscode.workspace.workspaceFolders![0].uri.path, 'lib/src/l10n/arb/app_en.arb');
};

export function activate(context: vscode.ExtensionContext) {
  let modifyArbDisposable = vscode.commands.registerCommand(
    'extension.modifyArb',
    () => {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found!');
        return;
      }

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

  let addArbDisposable = vscode.commands.registerCommand("extension.addToArb", () => {
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
    if (text.startsWith('"') || text.startsWith("'")) {
      text = text.slice(1);
    }

    if (text.endsWith('"') || text.endsWith("'")) {
      text = text.slice(0, -1);
    }

    // request a keyName
    let keyName: String;
    vscode.window.showInputBox({
      prompt: 'Enter the key name',
      title: 'key name',
    }).then((keyName) => {
      if (!keyName) {
        vscode.window.showErrorMessage('You need to specify a');
        return;
      }
      
      // read in the ARB file 
      fs.readFile(getArbPath()!, 'utf8', (err, data) => {
        if (err) {
          vscode.window.showErrorMessage('Failed to read ARB file');
          return;
        }
    
        let arbContent: any;
        try {
          arbContent = JSON.parse(data);
        } catch (e) {
          vscode.window.showErrorMessage('Failed to parse ARB file');
          return
        }

        // ensure we don't have this key already
        if (arbContent[keyName]) {
          vscode.window.showErrorMessage('Key already exists');
          
          // replace selection with the value of this key
          editor.edit((editBuilder) => {
            editBuilder.replace(selection, `Get.context!.l10n.${keyName}`);
          });

          return;
        }

        // ensure we don't have this string already
        for (const key in arbContent) {
          let keyString = arbContent[key];

          if (keyString.toLowerCase() === text.toLocaleLowerCase()) {
            vscode.window.showErrorMessage(`String already exists with key: ${key}`);
            // replace selection with the key we found
            editor.edit((editBuilder) => {
              editBuilder.replace(selection, `Get.context!.l10n.${key}`);
            });
            
            return;
          }
        }

        // create new key and string value to arb file
        arbContent[keyName] = text;
        // replace selection with the key we just created
        editor.edit((editBuilder) => {
          editBuilder.replace(selection, `Get.context!.l10n.${keyName}`);
        });

        modifyArbFile(keyName, text);
        modifyDartFile(keyName);
        runFlutterGenL10n();        
      });
    });
  });

  context.subscriptions.push(modifyArbDisposable);
  context.subscriptions.push(addArbDisposable);
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
  if (!getArbPath()) {
    return
  }

  fs.readFile(getArbPath()!, 'utf8', (err, data) => {
    if (err) {
      vscode.window.showErrorMessage('Failed to read ARB file');
      return;
    }

    let arbContent: any;

    try {
      arbContent = JSON.parse(data);
      arbContent[key] = translation;
      fs.writeFile(
        getArbPath()!,
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
    } catch (e) {
      vscode.window.showErrorMessage('Failed to parse ARB file');
      return;
    }
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
