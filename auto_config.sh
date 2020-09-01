#!/bin/bash

## ========================= HomeBrew ======================== ##
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

## ========================= ======================== ##
brew install emacs
brew install zsh
chsh -s /bin/zsh

## ========================= oh-my-zsh ======================== ##
$ sh -c "$(curl -fsSL https://raw.github.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"
