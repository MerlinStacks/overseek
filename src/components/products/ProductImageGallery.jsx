import React from 'react';
import { Package } from 'lucide-react';

const ProductImageGallery = ({ images = [], activeImage, setActiveImage }) => {
    const mainImage = images[activeImage]?.src;

    return (
        <div className="glass-panel-card" style={{ padding: '12px', minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {mainImage ? (
                <img src={mainImage} alt="Product Main" className="main-image" referrerPolicy="no-referrer" />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)', opacity: 0.5 }}>
                    <Package size={64} strokeWidth={1} />
                    <span style={{ marginTop: '1rem' }}>No Image Available</span>
                </div>
            )}

            {images.length > 1 && (
                <div className="gallery-grid" style={{ marginTop: '1rem', width: '100%' }}>
                    {images.map((img, index) => (
                        <img
                            key={img.id}
                            src={img.src}
                            className={`gallery-thumb ${index === activeImage ? 'active' : ''}`}
                            onClick={() => setActiveImage(index)}
                            alt=""
                            referrerPolicy="no-referrer"
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProductImageGallery;
