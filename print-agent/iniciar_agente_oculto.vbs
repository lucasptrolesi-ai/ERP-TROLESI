' Roda iniciar_agente.bat sem abrir janela de terminal — usado pelo atalho
' na pasta Inicializar do Windows pra o print-agent subir sozinho no login.
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
pastaScript = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.Run """" & pastaScript & "\iniciar_agente.bat""", 0, False
