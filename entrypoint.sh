#!/bin/bash 
set -e 
python3 scraper_service/service.py & 
exec npm start 
