' Oasis — silent launcher.
' Starts the local server hidden (no console window) if it isn't already
' running, waits until it answers, then opens Oasis as its own app window.
Option Explicit
Dim shell, fso, here, http, up, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

' --- is the server already up? ---
up = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "GET", "http://localhost:7777/", False
http.Send
If Err.Number = 0 And http.Status = 200 Then up = True
On Error GoTo 0

' --- start it hidden if needed, then wait for it ---
If Not up Then
  shell.Run "cmd /c node server.js", 0, False
  For i = 1 To 40
    WScript.Sleep 250
    On Error Resume Next
    Err.Clear
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "http://localhost:7777/", False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
      On Error GoTo 0
      Exit For
    End If
    On Error GoTo 0
  Next
End If

' --- open as a standalone app window (Edge), else default browser ---
Dim edge, candidates, p
edge = ""
candidates = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
  shell.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"), _
  shell.ExpandEnvironmentStrings("%LocalAppData%\Microsoft\Edge\Application\msedge.exe") )
For Each p In candidates
  If fso.FileExists(p) Then
    edge = p
    Exit For
  End If
Next

If edge <> "" Then
  shell.Run """" & edge & """ --app=http://localhost:7777 --window-size=1480,940 --user-data-dir=""" & shell.ExpandEnvironmentStrings("%LocalAppData%") & "\OasisApp""", 1, False
Else
  shell.Run "http://localhost:7777", 1, False
End If
