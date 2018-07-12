(add-to-list 'auto-mode-alist '("\\.cu\\'" . c++-mode))
(require 'package)
(add-to-list'package-archives
             '("melpa" . "http://melpa.milkbox.net/packages/") t)
(package-initialize)


(setq-default indent-tabs-mode nil)
(setq c-basic-offset 4)
(setq c-default-style "linux")
(setq default-tab-width 4)

;;(global-unset-key (kbd "C-SPC"))
;;(global-set-key (kbd "M-SPC") 'set-mark-command)

(setq make-backup-files nil)

(load-theme 'spacemacs-dark t)

(set-face-attribute 'default nil :height 200)

;; (defun insert-break-line()
;;   "Insert a break line at cursor point."
;;   (interactive)
;;   (insert "## =================================================")
;;   (eval (newline-and-indet))
;;   (insert "## "))
;; (define-key ess-mode-map (kbd "C-M-j") 'insert-break-line)
