#!/bin/bash

# Remember! Assignment is space-sensitive!

# Uncomment below if you permanently set a path for your poliwebex.js and node_modules folder

# poliwebex_folder_path="/home/$USER/Videos/PoliWebex/scripts"

read -p 'Drag here the directory where poliwebex.js is located (no_spaces_please): ' poliwebex_folder_path

read -p 'Drag here the URLs.txt formatted with one link per line (no_spaces_please): ' urls_file_path

read -p 'Enter the dest. path where you want to put your recordings (no_spaces_please): ' output_folder_path

cd $poliwebex_folder_path

node poliwebex.js -f $urls_file_path -o $output_folder_path

read -n 1 -s -r -p "Press any key to terminate..."
