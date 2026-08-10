!include "WinVer.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK "ALIVO OS requires Windows 10 or Windows 11."
    Quit
  ${EndIf}
!macroend
