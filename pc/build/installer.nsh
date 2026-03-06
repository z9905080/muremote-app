; 安裝前檢查主程式是否仍在執行
; 若正在執行，提示使用者關閉或自動強制結束

!macro preInit
  ; 使用 tasklist 查詢程序是否存在
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq MuRemote PC.exe" /NH'
  Pop $0 ; 返回碼
  Pop $1 ; 輸出內容

  ; 若輸出中包含 exe 名稱，代表程式正在執行
  ${If} $1 != ""
  ${AndIf} $1 != "INFO: No tasks are running which match the specified criteria."
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "MuRemote PC 正在執行中！$\n$\n請先關閉程式再繼續安裝。$\n$\n按「確定」自動關閉並繼續安裝，$\n按「取消」退出安裝程式。" \
      IDOK kill IDCANCEL abort

    kill:
      nsExec::Exec 'taskkill /F /IM "MuRemote PC.exe"'
      Sleep 1500
      Goto done

    abort:
      Abort

    done:
  ${EndIf}
!macroend
