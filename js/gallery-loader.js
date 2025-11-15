/**
 * Dynamic Image Gallery Loader
 * Dynamically generates image gallery items for event pages
 */

/**
 * Loads images dynamically into a gallery container
 * @param {string} galleryId - The ID of the gallery container element
 * @param {string} basePath - The base path to the image directory (e.g., '../../resources/noncurricular/srDonnaMaryVisit/')
 * @param {number} imageCount - Total number of images to load
 * @param {string} imagePrefix - Prefix for image filenames (e.g., 'dm_' for dm_1.jpg, dm_2.jpg, etc.)
 * @param {string} imageExtension - File extension (default: 'jpg')
 */
function loadGalleryImages(galleryId, basePath, imageCount, imagePrefix, imageExtension) {
    $(document).ready(function() {
        var extension = imageExtension || 'jpg';
        var gallery = $('#' + galleryId);
        
        // Clear existing content if any
        gallery.empty();
        
        for (var i = 1; i <= imageCount; i++) {
            var imageName = imagePrefix + i + '.' + extension;
            var imagePath = basePath + imageName;
            
            var listItem = '<li>' +
                '<a href="' + imagePath + '" target="_blank">' +
                '<img src="' + imagePath + '" class="img-thumbnail" />' +
                '</a><br />' +
                '</li>';
            
            gallery.append(listItem);
        }
    });
}

