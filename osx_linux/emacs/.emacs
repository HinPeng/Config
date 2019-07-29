(require 'package)
(add-to-list'package-archives
             '("melpa" . "http://melpa.milkbox.net/packages/") t)
(package-initialize)

;; ## ================================================= ##
;; Packages needed to be installed
;; atom-one-dark-theme
;; smex
;; multiple-cursors
;; flycheck

;; ## ================================================= ##
;; default setup
(setq-default indent-tabs-mode nil)
(setq c-basic-offset 2)
(setq c-default-style "linux")
(setq default-tab-width 2)

(setq make-backup-files nil)



;; ## ================================================= ##
;; elpa package setup

;; (load-theme 'spacemacs-dark t)

;; (set-face-attribute 'default nil :height 200)

;; (load-theme 'atom-one-dark t)

(if (daemonp)
    (add-hook 'after-make-frame-functions
        (lambda (frame)
            (select-frame frame)
            (load-theme 'atom-one-dark t)))
    (load-theme 'atom-one-dark t))

;; turn on mouse in console mode
;; (xterm-mouse-mode t)

;; (custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
;;  '(ansi-color-names-vector
;;    ["#080808" "#d70000" "#67b11d" "#875f00" "#268bd2" "#af00df" "#00ffff" "#b2b2b2"])
;;  '(custom-safe-themes
;;    (quote
;;     ("bffa9739ce0752a37d9b1eee78fc00ba159748f50dc328af4be661484848e476" default))))
;; (custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
;;  )
(custom-set-variables
 ;; custom-set-variables was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 '(custom-safe-themes
   (quote
    ("57f95012730e3a03ebddb7f2925861ade87f53d5bbb255398357731a7b1ac0e0" default)))
 '(package-selected-packages (quote (flycheck smex atom-one-dark-theme))))
(custom-set-faces
 ;; custom-set-faces was added by Custom.
 ;; If you edit it by hand, you could mess it up, so be careful.
 ;; Your init file should contain only one such instance.
 ;; If there is more than one, they won't work right.
 )


(require 'multiple-cursors)
(global-set-key (kbd "C-c m c") 'mc/edit-lines)
(global-set-key (kbd "C->") 'mc/mark-next-like-this)
(global-set-key (kbd "C-<") 'mc/mark-previous-like-this)
(global-set-key (kbd "C-c C-<") 'mc/mark-all-like-this)

(require 'smex) ; Not needed if you use package.el
(smex-initialize) ; Can be omitted. This might cause a (minimal) delay
                  ; when Smex is auto-initialized on its first run.
(global-set-key (kbd "M-x") 'smex)
(global-set-key (kbd "M-X") 'smex-major-mode-commands)
;; This is your old M-x.
(global-set-key (kbd "C-c C-c M-x") 'execute-extended-command)


;; ## ================================================= ##
;; code related setup

(add-to-list 'auto-mode-alist '("\\.cu\\'" . c++-mode))

;; ## ================================================= ##
;; my own func setup

(defun insert-break-line()
  "Insert a break line at cursor point."
  (interactive)
  (insert "## ================================================= ##")
  (eval (newline-and-indet))
  (insert "## "))
(define-key (current-global-map) (kbd "C-c j") 'insert-break-line)
